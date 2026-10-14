import { describe, expect, it } from "vitest";
import { enterpriseValue, impliedGrowth } from "./dcf";
import { computeMetrics } from "./metrics";
import { Series } from "./series";
import { analyze, scorecard } from "./steps";
import type { AssessmentMap, FinRow, Market } from "./types";

const flow = (metric: string, start: string, end: string, value: number): FinRow => ({ metric, period_start: start, period_end: end, value, origin: "ai" });
const point = (metric: string, end: string, value: number): FinRow => ({ metric, period_start: end, period_end: end, value, origin: "ai" });

// A company with Dec year-ends, revenue growing 25%/yr, plus a Q3 2026 10-Q (3-month + 9-month YTD columns).
function fixture(): FinRow[] {
  const rows: FinRow[] = [];
  const rev = [100, 125, 156.25, 195.3125, 244.140625]; // 2021..2025
  rev.forEach((r, i) => {
    const y = 2021 + i;
    const s = `${y}-01-01`, e = `${y}-12-31`;
    rows.push(flow("revenue", s, e, r * 1e9));
    rows.push(flow("operating_income", s, e, r * (0.25 + i * 0.01) * 1e9));
    rows.push(flow("operating_cash_flow", s, e, r * 0.32 * 1e9));
    rows.push(flow("capex", s, e, r * 0.04 * 1e9));
    rows.push(flow("interest_expense", s, e, 0.5e9));
    rows.push(point("cash_and_st_investments", e, (50 + i * 20) * 1e9));
    rows.push(point("total_debt", e, 10e9));
  });
  // Q3 2026 10-Q: nine months and three months, current and prior year.
  rows.push(flow("revenue", "2026-01-01", "2026-09-30", 230e9));
  rows.push(flow("revenue", "2025-01-01", "2025-09-30", 180e9));
  rows.push(flow("revenue", "2026-07-01", "2026-09-30", 82e9));
  rows.push(flow("revenue", "2025-07-01", "2025-09-30", 62e9));
  rows.push(flow("operating_income", "2026-01-01", "2026-09-30", 70e9));
  rows.push(flow("operating_income", "2025-01-01", "2025-09-30", 52e9));
  rows.push(point("cash_and_st_investments", "2026-09-30", 160e9));
  rows.push(point("total_debt", "2026-09-30", 10e9));
  rows.push(point("total_assets", "2026-09-30", 400e9));
  rows.push(point("total_liabilities", "2026-09-30", 120e9));
  rows.push(point("goodwill", "2026-09-30", 20e9));
  rows.push(point("current_assets", "2026-09-30", 220e9));
  rows.push(point("current_liabilities", "2026-09-30", 80e9));
  rows.push(point("total_equity", "2026-09-30", 280e9));
  return rows;
}

describe("Series", () => {
  it("derives discrete quarters from year-to-date columns", () => {
    const s = new Series([
      flow("operating_cash_flow", "2026-01-01", "2026-03-31", 10),
      flow("operating_cash_flow", "2026-01-01", "2026-06-30", 25),
      flow("operating_cash_flow", "2026-01-01", "2026-09-30", 45),
      flow("operating_cash_flow", "2026-01-01", "2026-12-31", 70),
    ]);
    expect(s.quarters("operating_cash_flow").map((q) => q.value)).toEqual([10, 15, 20, 25]);
    expect(s.ltm("operating_cash_flow")?.value).toBe(70);
  });

  it("computes LTM as FY + YTD − prior YTD", () => {
    const s = new Series(fixture());
    const ltm = s.ltm("revenue")!;
    expect(ltm.end).toBe("2026-09-30");
    expect(ltm.value).toBeCloseTo(244.140625e9 + 230e9 - 180e9);
  });

  it("prefers user-entered values", () => {
    const s = new Series([
      { ...point("total_debt", "2026-09-30", 5), origin: "ai" },
      { ...point("total_debt", "2026-09-30", 7), origin: "user" },
    ]);
    expect(s.latestPoint("total_debt")?.value).toBe(7);
  });
});

describe("metrics + scorecard", () => {
  const market: Market = { price: 100, market_cap: 2000e9, shares_outstanding: 20e9, short_interest_pct: 1, institutional_pct: 70, return_5y_pct: 200, spx_return_5y_pct: 90, earnings_misses_last4: 0 };

  it("computes key metrics", () => {
    const m = computeMetrics(fixture(), market);
    // Only one 10-Q: growth falls back to 9-month YTD vs. prior-year 9 months.
    expect(m.growthBasis).toBe("9-month year-to-date");
    expect(m.revGrowthPct!).toBeCloseTo((230 / 180 - 1) * 100);
    expect(m.revGrowthPrevPct!).toBeCloseTo(25);
    expect(m.expGrowthPct!).toBeCloseTo(((230 - 70) / (180 - 52) - 1) * 100);
    expect(m.cash).toBe(160e9);
    expect(m.solvency).toBeCloseTo((400 - 20) / 120);
    expect(m.annual).toHaveLength(5);
    expect(m.annual[4].revGrowthPct).toBeCloseTo(25);
  });

  it("scores objective categories from the guide's bands", () => {
    const m = computeMetrics(fixture(), market);
    const sc = scorecard(m, market, {});
    const p = Object.fromEntries(sc.items.map((i) => [i.id, i.points]));
    expect(p.cash_debt).toBe(10);
    expect(p.revenue_growth).toBe(10);
    expect(p.operating_margin).toBe(10);
    expect(p.short_interest).toBe(10);
    expect(p.institutional).toBe(10);
    expect(p.return_5y).toBe(10);
    expect(p.moat).toBeNull();
    expect(sc.missing).toBe(6);
  });

  it("lets a user override any score", () => {
    const m = computeMetrics(fixture(), market);
    const a: AssessmentMap = {
      "score.cash_debt": { key: "score.cash_debt", ai_value: null, user_value: 5 },
      "score.moat": { key: "score.moat", ai_value: 10, user_value: 5 },
    };
    const sc = scorecard(m, market, a);
    expect(sc.items.find((i) => i.id === "cash_debt")!.points).toBe(5);
    expect(sc.items.find((i) => i.id === "moat")!.points).toBe(5);
  });

  it("step 2 needs a valid reason when exactly one of three fails", () => {
    const rows = fixture().filter((r) => r.metric !== "total_debt").concat([point("total_debt", "2026-09-30", 500e9)]);
    const m = computeMetrics(rows, market);
    const s2 = analyze(m, market, {}).steps[1];
    expect(s2.status).toBe("fail");
    const withReason = analyze(m, market, { "step2.valid_reason": { key: "step2.valid_reason", ai_value: null, user_value: "infrastructure_leverage" } }).steps[1];
    expect(withReason.status).toBe("pass");
  });

  it("a manual step override wins", () => {
    const m = computeMetrics(fixture(), market);
    const r = analyze(m, market, { "override.step8": { key: "override.step8", ai_value: null, user_value: { status: "fail", reason: "test" } } });
    expect(r.steps[7].status).toBe("fail");
    expect(r.steps[7].computedStatus).toBe("pass");
  });
});

describe("DCF", () => {
  it("matches a hand calculation", () => {
    // rev0 100, g 0, margin 10% → FCF 10/yr; r 10%; TV = 10*1.04/0.06
    const pv = [1, 2, 3, 4, 5].reduce((s, t) => s + 10 / 1.1 ** t, 0) + (10 * 1.04) / 0.06 / 1.1 ** 5;
    expect(enterpriseValue(100, 0, 0.1, 0.1)).toBeCloseTo(pv, 6);
  });

  it("reverse DCF recovers the growth rate", () => {
    const ev = enterpriseValue(100, 0.18, 0.2, 0.1);
    expect(impliedGrowth(100, 0.2, ev)!).toBeCloseTo(0.18, 4);
  });
});
