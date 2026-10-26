// Turns raw extracted rows (annual, 3-month and year-to-date columns) into clean series.
import type { FinRow } from "./types";

const DAY = 86_400_000;
export const toMs = (d: string) => Date.parse(d + "T00:00:00Z");
export const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const durationDays = (start: string, end: string) => Math.round((toMs(end) - toMs(start)) / DAY) + 1;
const near = (a: string, b: string, tol: number) => Math.abs(toMs(a) - toMs(b)) <= tol * DAY;
const yearBefore = (d: string) => toDate(toMs(d) - 365 * DAY);

const isQuarter = (days: number) => days >= 80 && days <= 100;
const isAnnual = (days: number) => days >= 350 && days <= 380;

export interface Basis {
  kind: "ltm" | "ytd" | "annual";
  end: string;
  len?: number;
}

export interface Period {
  start: string;
  end: string;
  value: number;
  derived?: boolean;
  /** Capex the report doesn't show separately, counted as 0. */
  assumed?: boolean;
}

export class Series {
  private flows = new Map<string, FinRow[]>();
  private points = new Map<string, FinRow[]>();

  constructor(rows: FinRow[]) {
    for (const r of rows) {
      if (r.value === null || r.value === undefined || !Number.isFinite(Number(r.value))) continue;
      const row = { ...r, value: Number(r.value) };
      const isPoint = !r.period_start || r.period_start === r.period_end;
      const map = isPoint ? this.points : this.flows;
      if (!map.has(r.metric)) map.set(r.metric, []);
      map.get(r.metric)!.push(row);
    }
    // Some companies (asset-light software, ad tech) have no "purchases of property and equipment"
    // line at all; it's folded into "other investing activities". When a period's cash flow
    // statement was read (operating cash flow is there) but capex isn't, count capex as 0 so free
    // cash flow can still be worked out. It's marked as assumed and shown that way.
    const capex = this.flows.get("capex") ?? [];
    const have = new Set(capex.map((r) => `${r.period_start}|${r.period_end}`));
    for (const r of this.flows.get("operating_cash_flow") ?? []) {
      if (!r.period_start || have.has(`${r.period_start}|${r.period_end}`)) continue;
      capex.push({ metric: "capex", period_start: r.period_start, period_end: r.period_end, value: 0, origin: "ai", assumed: true });
      have.add(`${r.period_start}|${r.period_end}`);
    }
    if (capex.length) this.flows.set("capex", capex);
  }

  private flowRows(metric: string): FinRow[] {
    return (this.flows.get(metric) ?? []).filter((r) => r.period_start);
  }

  /**
   * The fiscal year's start (month-day), taken as the most common start of year-long periods
   * across all metrics. Trailing-twelve-month columns start in other months and are ignored.
   */
  private fyStart(): string | null {
    if (this._fyStart !== undefined) return this._fyStart;
    const counts = new Map<string, number>();
    for (const rows of this.flows.values()) {
      for (const r of rows) {
        if (r.period_start && isAnnual(durationDays(r.period_start, r.period_end))) {
          const md = r.period_start.slice(5);
          counts.set(md, (counts.get(md) ?? 0) + 1);
        }
      }
    }
    let best: string | null = null, n = 0;
    for (const [md, c] of counts) if (c > n) { best = md; n = c; }
    return (this._fyStart = best);
  }
  private _fyStart: string | null | undefined = undefined;

  /** Fiscal-year values, oldest first, one per year-end. */
  annual(metric: string): Period[] {
    const byEnd = new Map<string, Period>();
    const fy = this.fyStart();
    for (const r of this.flowRows(metric)) {
      if (!isAnnual(durationDays(r.period_start!, r.period_end))) continue;
      // 52/53-week years drift a few days, so allow a week either side of the usual start.
      if (fy && Math.abs(toMs(`2000-${r.period_start!.slice(5)}`) - toMs(`2000-${fy}`)) > 7 * DAY) continue;
      const prev = byEnd.get(r.period_end);
      if (!prev || r.origin === "user" || (prev.assumed && !r.assumed)) byEnd.set(r.period_end, { start: r.period_start!, end: r.period_end, value: r.value!, assumed: r.assumed });
    }
    return [...byEnd.values()].sort((a, b) => toMs(a.end) - toMs(b.end));
  }

  /** Discrete quarters (reported 3-month columns, plus quarters derived from year-to-date differences), oldest first. */
  quarters(metric: string): Period[] {
    const rows = this.flowRows(metric);
    const byEnd = new Map<string, Period>();
    for (const r of rows) {
      if (isQuarter(durationDays(r.period_start!, r.period_end))) {
        const prev = byEnd.get(r.period_end);
        if (!prev || !r.assumed || prev.assumed) byEnd.set(r.period_end, { start: r.period_start!, end: r.period_end, value: r.value!, assumed: r.assumed });
      }
    }
    // Year-to-date chains share a start date: Q2 = H1 − Q1, Q4 = FY − 9M, ...
    const groups = new Map<string, FinRow[]>();
    for (const r of rows) {
      if (!groups.has(r.period_start!)) groups.set(r.period_start!, []);
      groups.get(r.period_start!)!.push(r);
    }
    for (const g of groups.values()) {
      const sorted = [...new Map(g.map((r) => [r.period_end, r])).values()].sort((a, b) => toMs(a.period_end) - toMs(b.period_end));
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        const start = toDate(toMs(a.period_end) + DAY);
        if (!isQuarter(durationDays(start, b.period_end))) continue;
        if (!byEnd.has(b.period_end)) {
          byEnd.set(b.period_end, { start, end: b.period_end, value: b.value! - a.value!, derived: true, assumed: a.assumed && b.assumed });
        }
      }
    }
    return [...byEnd.values()].sort((a, b) => toMs(a.end) - toMs(b.end));
  }

  /** Sum of the 12 months ending near `end`, from an annual figure, 4 quarters, or FY + YTD − prior YTD. */
  windowSum(metric: string, end: string): number | null {
    const a = this.annual(metric).find((p) => near(p.end, end, 10));
    if (a) return a.value;
    const q = this.quarters(metric);
    const i = q.findIndex((p) => near(p.end, end, 10));
    if (i >= 3) {
      const four = q.slice(i - 3, i + 1);
      const contiguous = four.every((p, k) => k === 0 || near(toDate(toMs(four[k - 1].end) + DAY), p.start, 7));
      if (contiguous) return four.reduce((s, p) => s + p.value, 0);
    }
    // FY + YTD − prior-year YTD
    const rows = this.flowRows(metric);
    const ytds = rows.filter((r) => near(r.period_end, end, 10) && !isAnnual(durationDays(r.period_start!, r.period_end)));
    for (const ytd of ytds) {
      const len = durationDays(ytd.period_start!, ytd.period_end);
      const prior = rows.find((r) => near(r.period_end, yearBefore(end), 10) && Math.abs(durationDays(r.period_start!, r.period_end) - len) <= 10);
      const fy = this.annual(metric).find((p) => near(toDate(toMs(p.end) + DAY), ytd.period_start!, 10));
      if (prior && fy) return fy.value + ytd.value! - prior.value!;
    }
    return null;
  }

  /** Candidate period-ends for "last twelve months", newest first. */
  private ltmEnds(metric: string): string[] {
    const ends = new Set<string>();
    for (const r of this.flowRows(metric)) ends.add(r.period_end);
    return [...ends].sort((a, b) => toMs(b) - toMs(a));
  }

  ltm(metric: string): { value: number; end: string } | null {
    for (const end of this.ltmEnds(metric)) {
      const v = this.windowSum(metric, end);
      if (v !== null) return { value: v, end };
    }
    return null;
  }

  /** Point-in-time values (balance sheet), oldest first. */
  points_(metric: string): { end: string; value: number }[] {
    const byEnd = new Map<string, { end: string; value: number; user: boolean }>();
    for (const r of this.points.get(metric) ?? []) {
      const prev = byEnd.get(r.period_end);
      if (!prev || (r.origin === "user" && !prev.user)) byEnd.set(r.period_end, { end: r.period_end, value: r.value!, user: r.origin === "user" });
    }
    return [...byEnd.values()].sort((a, b) => toMs(a.end) - toMs(b.end)).map(({ end, value }) => ({ end, value }));
  }

  latestPoint(metric: string): { end: string; value: number } | null {
    const p = this.points_(metric);
    return p.length ? p[p.length - 1] : null;
  }

  pointAt(metric: string, end: string, tol = 10): number | null {
    const p = this.points_(metric).find((x) => near(x.end, end, tol));
    return p ? p.value : null;
  }

  /**
   * Current vs. year-earlier value on the best available basis:
   * trailing 12 months, else matching year-to-date columns, else the last two fiscal years.
   */
  growthBasis(metric: string): Basis | null {
    const ltm = this.ltm(metric);
    if (ltm && this.windowSum(metric, yearBefore(ltm.end)) !== null) return { kind: "ltm", end: ltm.end };
    if (ltm) {
      const rows = this.flowRows(metric).filter((r) => near(r.period_end, ltm.end, 10) && !isAnnual(durationDays(r.period_start!, r.period_end)));
      rows.sort((a, b) => durationDays(b.period_start!, b.period_end) - durationDays(a.period_start!, a.period_end));
      for (const r of rows) {
        const len = durationDays(r.period_start!, r.period_end);
        if (this.flowRows(metric).some((p) => near(p.period_end, yearBefore(ltm.end), 10) && Math.abs(durationDays(p.period_start!, p.period_end) - len) <= 10)) {
          return { kind: "ytd", end: ltm.end, len };
        }
      }
    }
    const a = this.annual(metric);
    if (a.length >= 2) return { kind: "annual", end: a[a.length - 1].end };
    return null;
  }

  pair(metric: string, b: Basis): [number, number] | null {
    if (b.kind === "ltm") {
      const c = this.windowSum(metric, b.end), p = this.windowSum(metric, yearBefore(b.end));
      return c !== null && p !== null ? [c, p] : null;
    }
    if (b.kind === "annual") {
      const a = this.annual(metric);
      const c = a.find((x) => near(x.end, b.end, 10)), p = a.find((x) => near(x.end, yearBefore(b.end), 10));
      return c && p ? [c.value, p.value] : null;
    }
    const rows = this.flowRows(metric);
    const c = rows.find((r) => near(r.period_end, b.end, 10) && Math.abs(durationDays(r.period_start!, r.period_end) - b.len!) <= 10);
    const p = rows.find((r) => near(r.period_end, yearBefore(b.end), 10) && Math.abs(durationDays(r.period_start!, r.period_end) - b.len!) <= 10);
    return c && p ? [c.value!, p.value!] : null;
  }

  /** The basis one year earlier, used to tell whether growth is falling. */
  previousBasis(metric: string, b: Basis): Basis | null {
    if (b.kind === "ltm") return { kind: "ltm", end: yearBefore(b.end) };
    const a = this.annual(metric);
    if (b.kind === "ytd") return a.length >= 2 ? { kind: "annual", end: a[a.length - 1].end } : null;
    return a.length >= 3 ? { kind: "annual", end: a[a.length - 2].end } : null;
  }

  /**
   * End date of the latest trailing-twelve-month figure, when it's newer than the last fiscal
   * year (i.e. quarterly reports exist after the last annual report). Null otherwise.
   */
  ttmEnd(metric = "revenue"): string | null {
    const l = this.ltm(metric);
    const lastFy = this.annual(metric).at(-1);
    if (!l) return null;
    if (lastFy && toMs(l.end) <= toMs(lastFy.end) + 10 * DAY) return null;
    return l.end;
  }

  hasAny(): boolean {
    return this.flows.size + this.points.size > 0;
  }
}

export { near, yearBefore };
