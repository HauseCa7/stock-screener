// Fetches price, market cap, multiples, 5-year return vs S&P 500 and earnings surprises from Alpha Vantage.
// POST { company_id }
import { authenticate, handler, HttpError, json } from "./common.ts";

const AV = "https://www.alphavantage.co/query";

class LimitError extends Error {}
class PremiumError extends Error {}

async function av(params: Record<string, string>): Promise<any> {
  const key = Deno.env.get("ALPHAVANTAGE_API_KEY");
  if (!key) throw new HttpError(500, "ALPHAVANTAGE_API_KEY is not set. Add it in Supabase → Edge Functions → Secrets.");
  const url = `${AV}?${new URLSearchParams({ ...params, apikey: key })}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  const note: string | undefined = body["Information"] ?? body["Note"];
  if (note) {
    // The daily-limit message also mentions "premium plans", so check it first.
    if (/rate limit|requests per (day|minute)|per day|spreading out/i.test(note)) throw new LimitError(`Alpha Vantage daily limit reached (about 25 requests a day on the free key). Try again tomorrow, or type the numbers in.`);
    if (/premium endpoint/i.test(note)) throw new PremiumError(`${params.function} needs a paid Alpha Vantage plan`);
    throw new Error(note);
  }
  if (body["Error Message"]) throw new Error(`Alpha Vantage: ${body["Error Message"]}`);
  return body;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

function fiveYearReturn(series: any): number | null {
  // Adjusted series include dividends; the plain monthly series is price-only.
  const s = series?.["Monthly Adjusted Time Series"] ?? series?.["Monthly Time Series"];
  if (!s) return null;
  const field = series?.["Monthly Adjusted Time Series"] ? "5. adjusted close" : "4. close";
  const dates = Object.keys(s).sort(); // ascending
  if (dates.length < 61) return null;
  const last = num(s[dates[dates.length - 1]][field]);
  const first = num(s[dates[dates.length - 61]][field]);
  if (!last || !first) return null;
  return (last / first - 1) * 100;
}

/** Monthly history, adjusted if the key allows it, otherwise price-only. */
async function monthly(symbol: string, warnings: string[]): Promise<any> {
  try {
    return await av({ function: "TIME_SERIES_MONTHLY_ADJUSTED", symbol });
  } catch (e) {
    if (!(e instanceof PremiumError)) throw e;
    if (!warnings.some((w) => w.includes("price-only"))) warnings.push("5-year returns are price-only (dividends excluded) on the free plan.");
    return await av({ function: "TIME_SERIES_MONTHLY", symbol });
  }
}

Deno.serve(handler(async (req) => {
  const ctx = await authenticate(req);
  const { company_id } = await req.json();
  const { data: co } = await ctx.db.from("companies").select("id, ticker, data_symbol").eq("id", company_id).single();
  if (!co) throw new HttpError(404, "Company not found.");
  const symbol = (co.data_symbol || co.ticker).trim().toUpperCase();

  const { data: existing } = await ctx.db.from("market_data").select("*").eq("company_id", company_id).maybeSingle();
  const origin: Record<string, string> = { ...(existing?.field_origin ?? {}) };
  const patch: Record<string, unknown> = {};
  const warnings: string[] = [];
  const set = (field: string, v: number | null) => {
    if (v === null || origin[field] === "user") return;
    patch[field] = v;
    origin[field] = "api";
  };

  // S&P 500 proxy (SPY), cached for a day to save API calls.
  let spx: number | null = null;
  const { data: cache } = await ctx.admin.from("market_cache").select("data, fetched_at").eq("key", "spy5y").maybeSingle();
  if (cache && Date.now() - new Date(cache.fetched_at).getTime() < 86_400_000) {
    spx = num(cache.data?.value);
  }

  const steps: [string, () => Promise<void>][] = [
    ["overview", async () => {
      const o = await av({ function: "OVERVIEW", symbol });
      if (!o || !o.Symbol) { warnings.push(`No company overview for ${symbol}. For non-US listings try a symbol like SHOP.TRT.`); return; }
      set("market_cap", num(o.MarketCapitalization));
      set("shares_outstanding", num(o.SharesOutstanding));
      set("forward_pe", num(o.ForwardPE));
      set("trailing_pe", num(o.PERatio));
      set("peg", num(o.PEGRatio));
      const inst = num(o.PercentInstitutions);
      if (inst !== null) set("institutional_pct", inst);
      const g = num(o.QuarterlyEarningsGrowthYOY);
      if (g !== null) set("eps_growth_pct", g * 100);
    }],
    ["quote", async () => {
      const q = await av({ function: "GLOBAL_QUOTE", symbol });
      set("price", num(q?.["Global Quote"]?.["05. price"]));
    }],
    ["history", async () => {
      set("return_5y_pct", fiveYearReturn(await monthly(symbol, warnings)));
    }],
    ["spx", async () => {
      if (spx === null) {
        spx = fiveYearReturn(await monthly("SPY", warnings));
        if (spx !== null) await ctx.admin.from("market_cache").upsert({ key: "spy5y", data: { value: spx }, fetched_at: new Date().toISOString() });
      }
      set("spx_return_5y_pct", spx);
    }],
    ["earnings", async () => {
      const e = await av({ function: "EARNINGS", symbol });
      const q = (e?.quarterlyEarnings ?? []).filter((x: any) => num(x.reportedEPS) !== null && num(x.estimatedEPS) !== null).slice(0, 4);
      if (q.length === 4) set("earnings_misses_last4", q.filter((x: any) => num(x.reportedEPS)! < num(x.estimatedEPS)!).length);
    }],
  ];
  const LABEL: Record<string, string> = {
    overview: "Market cap, P/E and PEG",
    quote: "Share price",
    history: "5-year return",
    spx: "S&P 500 5-year return",
    earnings: "Earnings misses",
  };
  for (const [name, fn] of steps) {
    try { await fn(); } catch (e) {
      if (e instanceof LimitError) { warnings.push((e as Error).message); break; }
      if (e instanceof PremiumError) { warnings.push(`${LABEL[name]}: not on the free Alpha Vantage plan, so type it in.`); continue; }
      warnings.push(`${LABEL[name]}: ${(e as Error).message}`);
    }
  }

  const row = { company_id, ...patch, field_origin: origin, fetched_at: new Date().toISOString() };
  const { error } = await ctx.db.from("market_data").upsert(row, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
  return json({ ok: true, updated: Object.keys(patch), warnings });
}));
