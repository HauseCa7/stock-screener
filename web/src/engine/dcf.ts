// Step 12 valuation: the 10–20 minute DCF and the reverse DCF, exactly as the guide describes.
import type { Metrics } from "./metrics";

export const TERMINAL_GROWTH = 0.04; // "a rule you don't break"
export const RATES = { bull: 0.08, base: 0.1, bear: 0.12 } as const;

export interface DcfInputs {
  baseRevenue: number | null;
  growthPct: number | null; // already trimmed
  rawGrowthPct: number | null; // 3-year average before the trim
  trimPct: number; // haircut applied to the average growth
  fcfMarginPct: number | null;
  cash: number | null;
  debt: number | null;
  shares: number | null;
}

export interface DcfCase {
  rate: number;
  perShare: number | null;
  upsidePct: number | null;
}

export interface Valuation {
  inputs: DcfInputs;
  cases: Record<"bull" | "base" | "bear", DcfCase>;
  impliedGrowthPct: number | null;
  growthGapPct: number | null; // current 3y growth − implied growth
  priceToSales: number | null;
  peg: number | null;
  missing: string[];
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function defaultInputs(m: Metrics, trimPct = 20): DcfInputs {
  const last3 = m.annual.slice(-3);
  const raw = avg(last3.map((r) => r.revGrowthPct));
  return {
    baseRevenue: m.revenueLtm ?? m.annual.at(-1)?.revenue ?? null,
    rawGrowthPct: raw,
    trimPct,
    growthPct: raw === null ? null : raw * (1 - trimPct / 100),
    fcfMarginPct: avg(last3.map((r) => r.fcfMarginPct)) ?? m.fcfMarginPct,
    cash: m.cash,
    debt: m.debt,
    shares: m.shares,
  };
}

/** Present value of 5 years of FCF plus a 4% terminal value (enterprise value). */
export function enterpriseValue(rev0: number, g: number, margin: number, r: number): number {
  let pv = 0;
  let fcf = 0;
  for (let t = 1; t <= 5; t++) {
    fcf = rev0 * Math.pow(1 + g, t) * margin;
    pv += fcf / Math.pow(1 + r, t);
  }
  const tv = (fcf * (1 + TERMINAL_GROWTH)) / (r - TERMINAL_GROWTH);
  return pv + tv / Math.pow(1 + r, 5);
}

/** Growth rate the current market price implies (10% discount rate), via bisection. */
export function impliedGrowth(rev0: number, margin: number, targetEv: number): number | null {
  if (rev0 <= 0 || margin <= 0 || targetEv <= 0) return null;
  let lo = -0.5, hi = 3;
  const f = (g: number) => enterpriseValue(rev0, g, margin, RATES.base) - targetEv;
  if (f(lo) > 0) return lo;
  if (f(hi) < 0) return null; // needs more than 300%/yr
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function valuation(m: Metrics, inp: DcfInputs, market: { peg?: number | null; forward_pe?: number | null; eps_growth_pct?: number | null } | null): Valuation {
  const missing: string[] = [];
  if (inp.baseRevenue === null) missing.push("revenue");
  if (inp.growthPct === null) missing.push("3-year revenue growth");
  if (inp.fcfMarginPct === null) missing.push("FCF margin");
  if (inp.shares === null) missing.push("shares outstanding");
  if (m.price === null) missing.push("share price");

  const mk = (rate: number): DcfCase => {
    if (inp.baseRevenue === null || inp.growthPct === null || inp.fcfMarginPct === null || inp.shares === null || inp.shares <= 0) {
      return { rate, perShare: null, upsidePct: null };
    }
    const ev = enterpriseValue(inp.baseRevenue, inp.growthPct / 100, inp.fcfMarginPct / 100, rate);
    const equity = ev + (inp.cash ?? 0) - (inp.debt ?? 0);
    const perShare = equity / inp.shares;
    return { rate, perShare, upsidePct: m.price ? (perShare / m.price - 1) * 100 : null };
  };

  let implied: number | null = null;
  if (m.marketCap !== null && inp.baseRevenue !== null && inp.fcfMarginPct !== null) {
    const targetEv = m.marketCap + (inp.debt ?? 0) - (inp.cash ?? 0);
    const g = impliedGrowth(inp.baseRevenue, inp.fcfMarginPct / 100, targetEv);
    implied = g === null ? null : g * 100;
  }
  const peg = market?.peg ?? (market?.forward_pe && market?.eps_growth_pct && market.eps_growth_pct > 0 ? market.forward_pe / market.eps_growth_pct : null);

  return {
    inputs: inp,
    cases: { bull: mk(RATES.bull), base: mk(RATES.base), bear: mk(RATES.bear) },
    impliedGrowthPct: implied,
    growthGapPct: implied !== null && inp.rawGrowthPct !== null ? inp.rawGrowthPct - implied : null,
    priceToSales: m.marketCap !== null && m.revenueLtm ? m.marketCap / m.revenueLtm : null,
    peg,
    missing,
  };
}
