// The scorecard as it stood at the end of each past quarter.
//
// For each quarter end, only figures for periods ending on or before that date are used, so
// growth, margins and cash vs. debt are what the reports showed then. Claude's judgment scores
// (moat, CEO, culture, ...) and the market numbers (short interest, institutional ownership,
// 5-year return) have no history here, so they are held at today's values and marked as such.
import { computeMetrics } from "./metrics";
import { Series } from "./series";
import { scorecard, type ScoreItem } from "./steps";
import type { AssessmentMap, FinRow, Market } from "./types";

/** Scorecard categories that move with the reported figures. */
export const DATED = new Set(["cash_debt", "revenue_growth", "operating_margin", "rev_vs_expenses"]);

export interface QuarterScore {
  end: string;
  label: string;
  total: number;
  items: ScoreItem[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const quarterLabel = (end: string) => `${MONTHS[Number(end.slice(5, 7)) - 1]} '${end.slice(2, 4)}`;

export function scoreByQuarter(rows: FinRow[], market: Market | null, a: AssessmentMap, count = 6): QuarterScore[] {
  const s = new Series(rows);
  // Quarter ends with a full 12 months of revenue behind them.
  const ends = [...new Set([...s.quarters("revenue"), ...s.annual("revenue")].map((p) => p.end))]
    .sort()
    .filter((e) => s.windowSum("revenue", e) !== null)
    .slice(-count);
  // Today's overrides of computed categories are about today, so past quarters use the computed value.
  const judgmentOnly: AssessmentMap = Object.fromEntries(
    Object.entries(a).filter(([k]) => !(k.startsWith("score.") && DATED.has(k.slice(6)))),
  );
  return ends.map((end) => {
    const asOf = rows.filter((r) => r.period_end <= end);
    const m = computeMetrics(asOf, market);
    const sc = scorecard(m, market, judgmentOnly);
    return { end, label: quarterLabel(end), total: sc.total, items: sc.items };
  });
}

/** Categories whose points changed between two quarters. */
export function changes(prev: QuarterScore, next: QuarterScore): { label: string; from: number | null; to: number | null; basis: string }[] {
  return next.items
    .map((it) => ({ it, before: prev.items.find((x) => x.id === it.id) }))
    .filter(({ it, before }) => (before?.points ?? null) !== it.points)
    .map(({ it, before }) => ({ label: it.label, from: before?.points ?? null, to: it.points, basis: it.basis }));
}
