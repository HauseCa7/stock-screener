import { createClient } from "@supabase/supabase-js";

// Public by design: access is enforced by login + row-level security.
export const SUPABASE_URL = "https://mwwjyirhpxccdscoklqw.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_fDPTmnE86rWt-uPJu2p23g_EXAwx7Yl";

export const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Calls an edge function and returns its JSON, throwing the server's error message on failure. */
export async function invoke<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as any).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      } catch {
        /* keep default message */
      }
    }
    throw new Error(msg);
  }
  return data as T;
}
