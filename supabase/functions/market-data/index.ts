// Market data for one company: Yahoo Finance first (no daily cap, includes short interest,
// institutional ownership, forward P/E, PEG and EPS surprises), Alpha Vantage as a backup.
// Values the user typed in are never overwritten.
// POST { company_id }
import { authenticate, handler, HttpError, json } from "./common.ts";

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Total return over the series, first point to last, in percent. */
const pctReturn = (first: number | null, last: number | null) => (first && last ? (last / first - 1) * 100 : null);

// ---------------------------------------------------------------- Yahoo Finance (unofficial endpoints)

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

class Yahoo {
  private cookie = "";
  private crumb = "";

  private async session() {
    if (this.crumb) return;
    const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
    const setCookie = r1.headers.get("set-cookie") ?? "";
    this.cookie = setCookie.split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, cookie: this.cookie } });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.length > 40) throw new Error(`Yahoo session failed (HTTP ${r2.status})`);
    this.crumb = crumb;
  }

  async summary(symbol: string): Promise<any> {
    await this.session();
    const modules = "price,summaryDetail,defaultKeyStatistics,earningsHistory";
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(this.crumb)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, cookie: this.cookie } });
    const body = await res.json().catch(() => null);
    const r = body?.quoteSummary?.result?.[0];
    if (!r) throw new Error(body?.quoteSummary?.error?.description ?? `Yahoo quote failed (HTTP ${res.status})`);
    return r;
  }

  /** Dividend-adjusted 5-year total return from monthly closes. */
  async fiveYear(symbol: string): Promise<number | null> {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1mo&events=div`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const body = await res.json().catch(() => null);
    const r = body?.chart?.result?.[0];
    const series: (number | null)[] = r?.indicators?.adjclose?.[0]?.adjclose ?? r?.indicators?.quote?.[0]?.close ?? [];
    const pts = series.filter((x): x is number => typeof x === "number" && x > 0);
    if (pts.length < 55) return null; // less than ~5 years of history
    return pctReturn(pts[0], pts[pts.length - 1]);
  }
}

// ---------------------------------------------------------------- Alpha Vantage (backup)

class LimitError extends Error {}
class PremiumError extends Error {}

async function av(params: Record<string, string>): Promise<any> {
  const key = Deno.env.get("ALPHAVANTAGE_API_KEY");
  if (!key) throw new Error("no Alpha Vantage key");
  const res = await fetch(`https://www.alphavantage.co/query?${new URLSearchParams({ ...params, apikey: key })}`);
  const body = await res.json().catch(() => ({}));
  const note: string | undefined = body["Information"] ?? body["Note"];
  if (note) {
    // The daily-limit message also mentions "premium plans", so check it first.
    if (/rate limit|requests per (day|minute)|per day|spreading out/i.test(note)) throw new LimitError("Alpha Vantage daily limit reached");
    if (/premium endpoint/i.test(note)) throw new PremiumError(`${params.function} needs a paid Alpha Vantage plan`);
    throw new Error(note);
  }
  if (body["Error Message"]) throw new Error(`Alpha Vantage: ${body["Error Message"]}`);
  return body;
}

async function avFiveYear(symbol: string): Promise<number | null> {
  let s: any;
  try {
    s = (await av({ function: "TIME_SERIES_MONTHLY_ADJUSTED", symbol }))["Monthly Adjusted Time Series"];
  } catch (e) {
    if (!(e instanceof PremiumError)) throw e;
    s = (await av({ function: "TIME_SERIES_MONTHLY", symbol }))["Monthly Time Series"];
  }
  if (!s) return null;
  const dates = Object.keys(s).sort();
  if (dates.length < 61) return null;
  const pick = (d: string) => num(s[d]["5. adjusted close"] ?? s[d]["4. close"]);
  return pctReturn(pick(dates[dates.length - 61]), pick(dates[dates.length - 1]));
}

// Toronto listings: Yahoo uses SHOP.TO, Alpha Vantage uses SHOP.TRT.
const yahooSymbol = (s: string) => s.replace(/\.TRT$/, ".TO").replace(/\.TRV$/, ".V");
const avSymbol = (s: string) => s.replace(/\.TO$/, ".TRT").replace(/\.V$/, ".TRV");

const LABEL: Record<string, string> = {
  price: "share price",
  market_cap: "market cap",
  shares_outstanding: "shares outstanding",
  forward_pe: "forward P/E",
  trailing_pe: "trailing P/E",
  peg: "PEG",
  short_interest_pct: "short interest",
  institutional_pct: "institutional ownership",
  return_5y_pct: "5-year return",
  spx_return_5y_pct: "S&P 500 5-year return",
  earnings_misses_last4: "earnings misses",
};

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
  const sources = new Set<string>();
  const set = (field: string, v: number | null, source: string) => {
    if (v === null || origin[field] === "user" || field in patch) return;
    patch[field] = v;
    origin[field] = "api";
    sources.add(source);
  };

  // ---- Yahoo
  const y = new Yahoo();
  let yahooFailed = false;
  try {
    const r = await y.summary(yahooSymbol(symbol));
    const ks = r.defaultKeyStatistics ?? {};
    const sd = r.summaryDetail ?? {};
    set("price", num(r.price?.regularMarketPrice?.raw), "Yahoo");
    set("market_cap", num(r.price?.marketCap?.raw ?? sd.marketCap?.raw), "Yahoo");
    set("shares_outstanding", num(ks.sharesOutstanding?.raw), "Yahoo");
    set("forward_pe", num(sd.forwardPE?.raw ?? ks.forwardPE?.raw), "Yahoo");
    set("trailing_pe", num(sd.trailingPE?.raw), "Yahoo");
    set("peg", num(ks.pegRatio?.raw), "Yahoo");
    const si = num(ks.shortPercentOfFloat?.raw);
    set("short_interest_pct", si === null ? null : si * 100, "Yahoo");
    const inst = num(ks.heldPercentInstitutions?.raw);
    set("institutional_pct", inst === null ? null : inst * 100, "Yahoo");
    const hist = (r.earningsHistory?.history ?? [])
      .map((h: any) => ({ a: num(h.epsActual?.raw), e: num(h.epsEstimate?.raw) }))
      .filter((h: any) => h.a !== null && h.e !== null)
      .slice(-4);
    if (hist.length === 4) set("earnings_misses_last4", hist.filter((h: any) => h.a < h.e).length, "Yahoo");
  } catch (e) {
    yahooFailed = true;
    warnings.push(`Yahoo Finance: ${(e as Error).message}.`);
  }
  try {
    set("return_5y_pct", await y.fiveYear(yahooSymbol(symbol)), "Yahoo");
  } catch (e) {
    if (!yahooFailed) warnings.push(`Yahoo 5-year history: ${(e as Error).message}.`);
  }

  // S&P 500 (SPY) 5-year return, cached for a day.
  const { data: cache } = await ctx.admin.from("market_cache").select("data, fetched_at").eq("key", "spy5y").maybeSingle();
  let spx: number | null = cache && Date.now() - new Date(cache.fetched_at).getTime() < 86_400_000 ? num(cache.data?.value) : null;
  if (spx === null) {
    spx = await y.fiveYear("SPY").catch(() => null);
    if (spx !== null) await ctx.admin.from("market_cache").upsert({ key: "spy5y", data: { value: spx }, fetched_at: new Date().toISOString() });
  }
  set("spx_return_5y_pct", spx, "Yahoo");

  // ---- Alpha Vantage backup, only for what's still missing.
  const want = (f: string) => !(f in patch) && origin[f] !== "user";
  if (Deno.env.get("ALPHAVANTAGE_API_KEY") && ["price", "return_5y_pct", "spx_return_5y_pct", "earnings_misses_last4"].some(want)) {
    const s = avSymbol(symbol);
    const steps: [string, () => Promise<void>][] = [
      ["price", async () => set("price", num((await av({ function: "GLOBAL_QUOTE", symbol: s }))?.["Global Quote"]?.["05. price"]), "Alpha Vantage")],
      ["return_5y_pct", async () => set("return_5y_pct", await avFiveYear(s), "Alpha Vantage")],
      ["spx_return_5y_pct", async () => set("spx_return_5y_pct", await avFiveYear("SPY"), "Alpha Vantage")],
      ["earnings_misses_last4", async () => {
        const q = ((await av({ function: "EARNINGS", symbol: s }))?.quarterlyEarnings ?? [])
          .filter((x: any) => num(x.reportedEPS) !== null && num(x.estimatedEPS) !== null).slice(0, 4);
        if (q.length === 4) set("earnings_misses_last4", q.filter((x: any) => num(x.reportedEPS)! < num(x.estimatedEPS)!).length, "Alpha Vantage");
      }],
    ];
    for (const [field, fn] of steps) {
      if (!want(field)) continue;
      try { await fn(); } catch (e) {
        if (e instanceof LimitError) break;
        if (!(e instanceof PremiumError)) console.error(e);
      }
    }
  }

  const missing = Object.keys(LABEL).filter((f) => want(f) && f !== "trailing_pe" && (existing as any)?.[f] == null);
  if (missing.length) warnings.push(`Not available automatically: ${missing.map((f) => LABEL[f]).join(", ")}. You can type these in.`);
  if (yahooFailed && !Object.keys(patch).length) warnings.push(/\.(TO|TRT|V)$/.test(symbol) ? "" : "For a non-US listing, set the market-data symbol (e.g. SHOP.TO).");

  const row = { company_id, ...patch, field_origin: origin, fetched_at: new Date().toISOString() };
  const { error } = await ctx.db.from("market_data").upsert(row, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
  return json({ ok: true, updated: Object.keys(patch), sources: [...sources], warnings: warnings.filter(Boolean) });
}));
