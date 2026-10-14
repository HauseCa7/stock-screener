import type { Assessment, FinRow, Market } from "../engine/types";
import { pdfToPages } from "./pdf";
import { invoke, supabase } from "./supabase";

export interface Company {
  id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  data_symbol: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Doc {
  id: string;
  company_id: string;
  kind: "annual" | "quarterly" | "transcript" | "other";
  fiscal_label: string | null;
  period_end: string | null;
  filename: string;
  storage_path: string | null;
  page_count: number | null;
  extract_status: "pending" | "running" | "done" | "error" | "skipped";
  extract_error: string | null;
  extracted_at: string | null;
  created_at: string;
}

export interface AiRun {
  id: string;
  company_id: string | null;
  kind: string;
  model: string | null;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  status: string;
  error: string | null;
  created_at: string;
}

export interface Prefs {
  extractModel?: string;
  judgeModel?: string;
  trimPct?: number;
}

export const GROUPS = ["trend", "business", "moat", "management", "risks"] as const;
export type Group = (typeof GROUPS)[number];

const DOC_COLS = "id, company_id, kind, fiscal_label, period_end, filename, storage_path, page_count, extract_status, extract_error, extracted_at, created_at";

function must<T>(r: { data: T | null; error: any }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// ---------------------------------------------------------------- loading

export interface Bundle {
  company: Company;
  docs: Doc[];
  financials: FinRow[];
  market: Market | null;
  assessments: Record<string, Assessment>;
}

export async function loadCompany(id: string): Promise<Bundle> {
  const [c, d, f, m, a] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).single(),
    supabase.from("documents").select(DOC_COLS).eq("company_id", id).order("period_end", { ascending: false, nullsFirst: true }),
    supabase.from("financials").select("*").eq("company_id", id),
    supabase.from("market_data").select("*").eq("company_id", id).maybeSingle(),
    supabase.from("assessments").select("*").eq("company_id", id),
  ]);
  return {
    company: must(c) as Company,
    docs: (must(d) ?? []) as Doc[],
    financials: (must(f) ?? []) as FinRow[],
    market: (m.data ?? null) as Market | null,
    assessments: Object.fromEntries(((must(a) ?? []) as Assessment[]).map((x) => [x.key, x])),
  };
}

export async function loadEverything(): Promise<Bundle[]> {
  const [c, d, f, m, a] = await Promise.all([
    supabase.from("companies").select("*").order("ticker"),
    supabase.from("documents").select(DOC_COLS),
    supabase.from("financials").select("*").limit(50000),
    supabase.from("market_data").select("*"),
    supabase.from("assessments").select("*").limit(50000),
  ]);
  const companies = (must(c) ?? []) as Company[];
  const by = <T extends { company_id?: string }>(rows: T[], id: string) => rows.filter((r: any) => r.company_id === id);
  return companies.map((co) => ({
    company: co,
    docs: by((d.data ?? []) as Doc[], co.id),
    financials: by((f.data ?? []) as any[], co.id) as FinRow[],
    market: ((m.data ?? []) as any[]).find((x) => x.company_id === co.id) ?? null,
    assessments: Object.fromEntries((by((a.data ?? []) as any[], co.id) as Assessment[]).map((x) => [x.key, x])),
  }));
}

// ---------------------------------------------------------------- companies

export async function createCompany(ticker: string, dataSymbol?: string): Promise<Company> {
  return must(
    await supabase
      .from("companies")
      .insert({ ticker: ticker.trim().toUpperCase(), data_symbol: dataSymbol?.trim().toUpperCase() || null })
      .select("*")
      .single(),
  ) as Company;
}

export async function updateCompany(id: string, patch: Partial<Company>) {
  must(await supabase.from("companies").update(patch).eq("id", id));
}

export async function deleteCompany(c: Company) {
  const { data: docs } = await supabase.from("documents").select("storage_path").eq("company_id", c.id);
  const paths = (docs ?? []).map((d: any) => d.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from("reports").remove(paths);
  must(await supabase.from("companies").delete().eq("id", c.id));
}

// ---------------------------------------------------------------- documents

export async function uploadDocument(
  company: Company,
  file: File,
  kind: Doc["kind"],
  onStage: (s: string) => void,
): Promise<Doc> {
  onStage("Reading PDF…");
  const pages = await pdfToPages(file, (i, n) => onStage(`Reading page ${i} of ${n}…`));
  const chars = pages.reduce((s, p) => s + p.length, 0);
  if (chars < 1500) throw new Error("This PDF has almost no text. It may be a scanned image; try the text version from the company's investor-relations site.");

  onStage("Uploading…");
  const { data: u } = await supabase.auth.getUser();
  const path = `${u.user!.id}/${company.id}/${crypto.randomUUID()}.pdf`;
  const up = await supabase.storage.from("reports").upload(path, file, { contentType: "application/pdf" });
  if (up.error) throw new Error(up.error.message);

  const doc = must(
    await supabase
      .from("documents")
      .insert({
        company_id: company.id,
        kind,
        filename: file.name,
        storage_path: path,
        page_count: pages.length,
        pages,
        extract_status: kind === "annual" || kind === "quarterly" ? "pending" : "skipped",
      })
      .select(DOC_COLS)
      .single(),
  ) as Doc;
  return doc;
}

export async function extractDocument(docId: string, model?: string) {
  return invoke<{ ok: boolean; rows: number; warnings: string[] }>("extract-financials", { document_id: docId, model });
}

export async function updateDocument(id: string, patch: Partial<Doc>) {
  must(await supabase.from("documents").update(patch).eq("id", id));
}

export async function deleteDocument(doc: Doc, alsoFigures: boolean) {
  if (alsoFigures) {
    must(await supabase.from("financials").delete().eq("source_doc_id", doc.id).eq("origin", "ai"));
  }
  if (doc.storage_path) await supabase.storage.from("reports").remove([doc.storage_path]);
  must(await supabase.from("documents").delete().eq("id", doc.id));
}

export async function openPdf(doc: Pick<Doc, "storage_path">, page?: number | null) {
  if (!doc.storage_path) return;
  const { data, error } = await supabase.storage.from("reports").createSignedUrl(doc.storage_path, 600);
  if (error || !data) throw new Error(error?.message ?? "Could not open the file.");
  window.open(data.signedUrl + (page ? `#page=${page}` : ""), "_blank", "noopener");
}

// ---------------------------------------------------------------- financials

export async function saveFinancial(companyId: string, row: { id?: string; metric: string; period_start: string; period_end: string; value: number | null }) {
  if (row.value === null) {
    if (row.id) must(await supabase.from("financials").delete().eq("id", row.id));
    return;
  }
  must(
    await supabase.from("financials").upsert(
      { company_id: companyId, metric: row.metric, period_start: row.period_start, period_end: row.period_end, value: row.value, origin: "user" },
      { onConflict: "company_id,metric,period_start,period_end" },
    ),
  );
}

// ---------------------------------------------------------------- market data

export async function saveMarketField(companyId: string, field: string, value: number | null, current: Market | null) {
  const origin = { ...(current?.field_origin ?? {}) };
  if (value === null) delete origin[field];
  else origin[field] = "user";
  must(
    await supabase
      .from("market_data")
      .upsert({ company_id: companyId, [field]: value, field_origin: origin }, { onConflict: "company_id" }),
  );
}

/** Saves several market numbers at once; each is marked as entered by you, so refreshes won't overwrite it. */
export async function saveMarketFields(companyId: string, values: Record<string, number | null>, current: Market | null) {
  const origin = { ...(current?.field_origin ?? {}) };
  for (const [k, v] of Object.entries(values)) {
    if (v === null) delete origin[k];
    else origin[k] = "user";
  }
  must(
    await supabase
      .from("market_data")
      .upsert({ company_id: companyId, ...values, field_origin: origin }, { onConflict: "company_id" }),
  );
}

export async function refreshMarket(companyId: string) {
  return invoke<{ ok: boolean; updated: string[]; sources?: string[]; missing?: string[]; warnings: string[] }>("market-data", { company_id: companyId });
}

// ---------------------------------------------------------------- assessments

export async function setUserValue(companyId: string, key: string, value: unknown, note?: string | null) {
  must(
    await supabase.from("assessments").upsert(
      { company_id: companyId, key, user_value: value, user_note: note ?? null, user_updated_at: new Date().toISOString() },
      { onConflict: "company_id,key" },
    ),
  );
}

export async function clearUserValue(companyId: string, key: string) {
  must(
    await supabase
      .from("assessments")
      .update({ user_value: null, user_note: null, user_updated_at: null })
      .eq("company_id", companyId)
      .eq("key", key),
  );
}

export async function draftGroup(companyId: string, group: Group, metricsSummary: string, model?: string) {
  return invoke<{ ok: boolean; keys: string[] }>("draft-assessments", { company_id: companyId, group, metrics_summary: metricsSummary, model });
}

// ---------------------------------------------------------------- misc

export async function getPrefs(): Promise<Prefs> {
  const { data } = await supabase.from("settings").select("prefs").maybeSingle();
  return (data?.prefs ?? {}) as Prefs;
}

export async function savePrefs(prefs: Prefs) {
  must(await supabase.from("settings").upsert({ prefs, updated_at: new Date().toISOString() }));
}

export async function listRuns(limit = 200): Promise<AiRun[]> {
  return (must(await supabase.from("ai_runs").select("*").order("created_at", { ascending: false }).limit(limit)) ?? []) as AiRun[];
}

export async function saveSnapshot(companyId: string, snap: { total: number; band: string; steps_passed: number; breakdown: unknown }) {
  must(await supabase.from("score_history").insert({ company_id: companyId, ...snap }));
}

export async function listSnapshots(companyId: string) {
  return (must(await supabase.from("score_history").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20)) ?? []) as any[];
}
