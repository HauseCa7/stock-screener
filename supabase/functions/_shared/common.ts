// Shared helpers for all edge functions (copied into each function at deploy time).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export interface Ctx {
  db: SupabaseClient; // acts as the signed-in user (RLS applies)
  admin: SupabaseClient; // service role, for logs and caches only
  userId: string;
}

/** Verifies the caller is signed in AND is the app owner. */
export async function authenticate(req: Request): Promise<Ctx> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new HttpError(401, "Not signed in.");
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (error || !data.user) throw new HttpError(401, "Session expired. Sign in again.");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: owner } = await admin
    .from("app_owners")
    .select("email")
    .ilike("email", data.user.email ?? "")
    .maybeSingle();
  if (!owner) throw new HttpError(403, "This account is not allowed to use the app.");
  return { db, admin, userId: data.user.id };
}

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(e);
      return json({ error: (e as Error).message ?? String(e) }, status);
    }
  };
}

// ---------------------------------------------------------------- Claude API

export const MODELS: Record<string, { in: number; out: number; cacheW: number; cacheR: number }> = {
  // USD per million tokens
  "claude-opus-5-5": { in: 4, out: 20, cacheW: 5, cacheR: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheW: 2.5, cacheR: 0.1 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheW: 0.125, cacheR: 0.01 },
};
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function pickModel(m: unknown): string {
  return typeof m === "string" && m in MODELS ? m : DEFAULT_MODEL;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function costOf(model: string, u: Usage): number {
  const p = MODELS[model] ?? MODELS[DEFAULT_MODEL];
  const r = u.cache_read_input_tokens ?? 0;
  const w = u.cache_creation_input_tokens ?? 0;
  return (u.input_tokens * p.in + w * p.cacheW + r * p.cacheR + u.output_tokens * p.out) / 1e6;
}

export interface ClaudeCall {
  model: string;
  system: string;
  tools: { name: string; description: string; input_schema: any }[];
  toolName: string; // the tool Claude is asked to call
  content: unknown[]; // content blocks for the single user message
  maxTokens: number;
  /** Strict tools guarantee the schema, but the API caps their combined size. Default true. */
  strict?: boolean;
  /** For non-strict tools: return a description of what's wrong with the answer, or null if it's fine. */
  validate?: (input: any) => string | null;
  /** When the retry is still incomplete, return that last answer instead of failing (the caller keeps the good parts). */
  acceptPartial?: boolean;
}

/**
 * Makes a JSON schema valid for strict tool use: every object closed and fully required,
 * no array-size limits beyond minItems 0/1. Descriptions keep the human guidance.
 */
export function strictify(schema: any): any {
  if (Array.isArray(schema)) return schema.map(strictify);
  if (!schema || typeof schema !== "object") return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "maxItems") continue;
    if (k === "minItems" && typeof v === "number" && v > 1) { out.minItems = 1; continue; }
    out[k] = k === "properties"
      ? Object.fromEntries(Object.entries(v as any).map(([pk, pv]) => [pk, strictify(pv)]))
      : strictify(v);
  }
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}

export async function callClaude(c: ClaudeCall): Promise<{ toolName: string; input: any; usage: Usage; problem?: string | null }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    throw new HttpError(
      500,
      "ANTHROPIC_API_KEY is not set. Add it in Supabase → Edge Functions → Secrets.",
    );
  }
  const headers: Record<string, string> = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  // Organization-level keys (not scoped to a workspace) must name the workspace on every request.
  const workspace = Deno.env.get("ANTHROPIC_WORKSPACE_ID");
  if (workspace) headers["anthropic-workspace-id"] = workspace.trim();
  // Newer models reject forced tool choice, so tools are offered with tool_choice "auto",
  // marked strict (output must match the schema), and Claude is told which one to call.
  const strict = c.strict ?? true;
  const tools = c.tools.map((t) => (strict ? { ...t, strict: true, input_schema: strictify(t.input_schema) } : t));
  const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let content = c.content;
  let lastProblem: string | null = null;
  let lastBlock: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: c.model,
        max_tokens: c.maxTokens,
        system: c.system,
        tools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = body?.error?.message ?? `HTTP ${res.status}`;
      if (/workspace/i.test(msg) && !workspace) {
        msg += " Fix: add a Supabase secret ANTHROPIC_WORKSPACE_ID, or use an API key created inside a workspace.";
      }
      throw new HttpError(502, `Claude API error: ${msg}`);
    }
    const u = body.usage ?? {};
    usage.input_tokens += u.input_tokens ?? 0;
    usage.output_tokens += u.output_tokens ?? 0;
    usage.cache_read_input_tokens! += u.cache_read_input_tokens ?? 0;
    usage.cache_creation_input_tokens! += u.cache_creation_input_tokens ?? 0;
    if (body.stop_reason === "max_tokens") {
      throw new HttpError(502, "Claude's answer was cut off (too long). Try again or use fewer documents.");
    }
    if (body.stop_reason === "refusal") throw new HttpError(502, "Claude declined to answer this request.");
    const block = (body.content ?? []).find((b: any) => b.type === "tool_use" && b.name === c.toolName);
    const problem = block ? c.validate?.(block.input) ?? null : `Respond only by calling the ${c.toolName} tool.`;
    if (block && !problem) return { toolName: block.name, input: block.input, usage };
    lastProblem = problem;
    if (block) lastBlock = block;
    // Ask once more, saying exactly what was wrong.
    content = [...c.content, { type: "text", text: block ? `Your previous ${c.toolName} call was incomplete: ${problem} Call ${c.toolName} again with every field filled.` : problem! }];
  }
  if (c.acceptPartial && lastBlock) return { toolName: lastBlock.name, input: lastBlock.input, usage, problem: lastProblem };
  throw new HttpError(502, `Claude's ${c.toolName} answer wasn't complete (${lastProblem}). Try again.`);
}

export async function logRun(
  ctx: Ctx,
  row: Record<string, unknown>,
): Promise<string | null> {
  const { data } = await ctx.admin
    .from("ai_runs")
    .insert({ user_id: ctx.userId, ...row })
    .select("id")
    .single();
  return data?.id ?? null;
}

export async function finishRun(
  ctx: Ctx,
  id: string | null,
  model: string,
  usage: Usage | null,
  error?: string,
) {
  if (!id) return;
  await ctx.admin
    .from("ai_runs")
    .update({
      status: error ? "error" : "done",
      error: error ?? null,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      cache_read_tokens: usage?.cache_read_input_tokens ?? null,
      cache_write_tokens: usage?.cache_creation_input_tokens ?? null,
      cost_usd: usage ? costOf(model, usage) : null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// ---------------------------------------------------------------- page selection

/** Count of number-like tokens on a page (to tell statement tables from prose). */
export function numericDensity(text: string): number {
  return (text.match(/\(?\$?\d[\d,]*\.?\d*\)?/g) ?? []).length;
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "\n[…truncated]";
}
