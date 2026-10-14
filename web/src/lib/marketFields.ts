// Market numbers the analysis uses, and exactly where to find each one on Yahoo Finance.
import type { Market } from "../engine/types";

export type YahooPage = "summary" | "statistics" | "holders" | "analysis" | "spx";
export type Format = "price" | "big" | "pct" | "ratio" | "count";

export interface MarketField {
  k: keyof Market & string;
  label: string;
  /** Used by the 12 steps or the scorecard (vs. shown for reference in valuation). */
  needed: boolean;
  usedFor: string;
  page: YahooPage;
  where: string;
  format: Format;
  example: string;
}

export const MARKET_FIELDS: MarketField[] = [
  {
    k: "price", label: "Share price", needed: true, usedFor: "Valuation (step 12) and market cap",
    page: "summary", where: "The large price at the top of the page.", format: "price", example: "200.97",
  },
  {
    k: "market_cap", label: "Market cap", needed: true, usedFor: "Instant kill (under $1B) and the reverse DCF",
    page: "summary", where: "\"Market Cap (intraday)\" in the table under the chart.", format: "big", example: "483.18B",
  },
  {
    k: "short_interest_pct", label: "Short interest (% of float)", needed: true, usedFor: "Scorecard and an instant kill (above 10%)",
    page: "statistics", where: "Share Statistics section → \"Short % of Float\".", format: "pct", example: "2.59%",
  },
  {
    k: "institutional_pct", label: "Institutional ownership", needed: true, usedFor: "Scorecard",
    page: "holders", where: "\"% of Shares Held by Institutions\" near the top.", format: "pct", example: "64.68%",
  },
  {
    k: "return_5y_pct", label: "5-year return", needed: true, usedFor: "Scorecard (vs. the S&P 500)",
    page: "summary", where: "Click \"5Y\" above the chart; use the % change shown next to the price.", format: "pct", example: "1,250.4%",
  },
  {
    k: "spx_return_5y_pct", label: "S&P 500 5-year return", needed: true, usedFor: "Scorecard (benchmark for the 5-year return)",
    page: "spx", where: "S&P 500 page: click \"5Y\" above the chart and use the % change.", format: "pct", example: "88.2%",
  },
  {
    k: "earnings_misses_last4", label: "Earnings misses, last 4 quarters", needed: true, usedFor: "Instant kill (2 or more misses)",
    page: "analysis", where: "\"Earnings History\" table: count the quarters where \"Surprise %\" is negative.", format: "count", example: "0",
  },
  {
    k: "shares_outstanding", label: "Shares outstanding", needed: false, usedFor: "DCF value per share (the reports usually supply it)",
    page: "statistics", where: "Share Statistics section → \"Shares Outstanding\".", format: "big", example: "2.36B",
  },
  {
    k: "forward_pe", label: "Forward P/E", needed: false, usedFor: "Valuation multiples",
    page: "statistics", where: "Valuation Measures → \"Forward P/E\", the \"Current\" column.", format: "ratio", example: "85.47",
  },
  {
    k: "peg", label: "PEG ratio", needed: false, usedFor: "Valuation multiples",
    page: "statistics", where: "Valuation Measures → \"PEG Ratio (5yr expected)\".", format: "ratio", example: "1.81",
  },
];

/** Yahoo uses .TO for Toronto listings (Alpha Vantage uses .TRT). */
export function yahooSymbol(ticker: string, dataSymbol?: string | null): string {
  return (dataSymbol || ticker).trim().toUpperCase().replace(/\.TRT$/, ".TO").replace(/\.TRV$/, ".V");
}

export function yahooUrl(symbol: string, page: YahooPage): string {
  if (page === "spx") return "https://finance.yahoo.com/quote/%5EGSPC/";
  const s = encodeURIComponent(symbol);
  return {
    summary: `https://finance.yahoo.com/quote/${s}/`,
    statistics: `https://finance.yahoo.com/quote/${s}/key-statistics/`,
    holders: `https://finance.yahoo.com/quote/${s}/holders/`,
    analysis: `https://finance.yahoo.com/quote/${s}/analysis/`,
  }[page];
}

export const PAGE_NAME: Record<YahooPage, string> = {
  summary: "Summary",
  statistics: "Statistics",
  holders: "Holders",
  analysis: "Analysis",
  spx: "S&P 500",
};

/**
 * Reads a number the way Yahoo prints it: "483.18B", "2.59%", "+1,250.40%", "$200.97", "2.36B".
 * Returns null for empty input; throws a readable message for anything it can't read.
 */
export function parseInput(raw: string, format: Format): number | null {
  const s = raw.trim().replace(/[,\s$]/g, "").replace(/^\+/, "").replace(/−/g, "-");
  if (!s) return null;
  const m = /^(-?\d*\.?\d+)(%|[kKmMbBtT])?$/.exec(s);
  if (!m) throw new Error(`Couldn't read "${raw}". Try a format like ${format === "big" ? "483.18B" : format === "pct" ? "2.59%" : "1.81"}.`);
  let v = parseFloat(m[1]);
  const suffix = m[2]?.toUpperCase();
  if (suffix && suffix !== "%") {
    if (format !== "big") throw new Error(`"${raw}" has a ${suffix} suffix, which doesn't fit this field.`);
    v *= { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[suffix as "K" | "M" | "B" | "T"];
  }
  if (format === "count") {
    if (!Number.isInteger(v) || v < 0 || v > 4) throw new Error("Enter a whole number from 0 to 4.");
  }
  if (format === "big" && !suffix && v < 1e5) throw new Error(`"${raw}" looks too small. Copy it with its suffix, e.g. 483.18B.`);
  if (format === "price" && v <= 0) throw new Error("The price must be above zero.");
  return v;
}

/** How a stored value is shown back in the input, in Yahoo's style. */
export function showInput(v: number | null | undefined, format: Format): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  if (format === "big") {
    const a = Math.abs(v);
    if (a >= 1e12) return `${+(v / 1e12).toFixed(3)}T`;
    if (a >= 1e9) return `${+(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
    return String(v);
  }
  if (format === "pct") return `${+v.toFixed(2)}%`;
  return String(+v.toFixed(2));
}

/** Fields the analysis needs that have no value yet. Market cap isn't needed if price and shares can produce it. */
export function missingFields(m: Market | null, sharesFromReports: number | null): MarketField[] {
  return MARKET_FIELDS.filter((f) => {
    if (!f.needed) return false;
    const v = (m as any)?.[f.k];
    if (v !== null && v !== undefined) return false;
    if (f.k === "market_cap" && m?.price != null && (m?.shares_outstanding != null || sharesFromReports != null)) return false;
    return true;
  });
}
