// Bar charts of the key financial criteria over time: is the business getting better?
// One small chart per measure (never two scales on one chart), same periods across all of them,
// following the Financials tab's Fiscal years / Quarters switch. The fiscal-year view ends with
// one extra "TTM" bar: the latest four quarters, so the newest numbers sit next to the history.
import { useMemo, useState } from "react";
import { money } from "../engine/format";
import { near, Series, yearBefore } from "../engine/series";

export type TrendView = "annual" | "quarterly";

interface Point { end: string; label: string; value: number | null; ttm?: boolean }
interface Measure { id: string; title: string; unit: "money" | "pct"; points: Point[]; better: "up" | "down"; note?: string }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (end: string) => `${MONTHS[Number(end.slice(5, 7)) - 1]} '${end.slice(2, 4)}`;

function fmt(v: number | null, unit: Measure["unit"]): string {
  if (v === null) return "—";
  return unit === "pct" ? `${v.toFixed(1)}%` : money(v);
}

interface Slot { end: string; label: string; ttm?: boolean }

/** Every measure's value at each period end, for the chosen view. */
export function buildMeasures(s: Series, view: TrendView): Measure[] {
  let slots: Slot[];
  if (view === "annual") {
    slots = s.annual("revenue").slice(-6).map((p) => ({ end: p.end, label: `FY${p.end.slice(2, 4)}` }));
    const t = s.ttmEnd();
    if (t) slots.push({ end: t, label: "TTM", ttm: true });
  } else {
    slots = s.quarters("revenue").slice(-8).map((p) => ({ end: p.end, label: shortDate(p.end) }));
  }

  // A flow measure for a slot, or for the same-length period a year before it (for growth).
  const flowAt = (metric: string, slot: Slot, yearAgo = false): number | null => {
    const end = yearAgo ? yearBefore(slot.end) : slot.end;
    if (slot.ttm) return s.windowSum(metric, end);
    if (view === "annual") return s.annual(metric).find((p) => near(p.end, end, 10))?.value ?? null;
    return s.quarters(metric).find((p) => near(p.end, end, 10))?.value ?? null;
  };
  const div = (a: number | null, b: number | null) => (a !== null && b ? (a / b) * 100 : null);
  const rev = (x: Slot) => flowAt("revenue", x);
  const fcf = (x: Slot) => {
    const o = flowAt("operating_cash_flow", x), k = flowAt("capex", x);
    return o !== null && k !== null ? o - k : null;
  };
  const growth = (x: Slot) => {
    const now = rev(x), prior = flowAt("revenue", x, true);
    return now !== null && prior ? ((now - prior) / Math.abs(prior)) * 100 : null;
  };
  const netCash = (x: Slot) => {
    const c = s.pointAt("cash_and_st_investments", x.end, 10), d = s.pointAt("total_debt", x.end, 10);
    return c !== null && d !== null ? c - d : null;
  };
  const pts = (f: (x: Slot) => number | null): Point[] => slots.map((x) => ({ ...x, value: f(x) }));
  const span = view === "annual" ? "fiscal year (TTM: the latest four quarters)" : "quarter";
  const capexAssumed = slots.some((x) => !x.ttm && (view === "annual" ? s.annual("capex") : s.quarters("capex")).some((p) => p.assumed && near(p.end, x.end, 10)))
    || (slots.some((x) => x.ttm) && s.quarters("capex").slice(-4).some((p) => p.assumed));
  const fcfNote = `Operating cash flow minus capex, per ${span}.${capexAssumed ? " Some reports show no separate capex line, so it's counted as 0 there." : ""}`;

  return [
    { id: "revenue", title: "Revenue", unit: "money", better: "up", points: pts(rev) },
    { id: "growth", title: "Revenue growth vs. a year earlier", unit: "pct", better: "up", points: pts(growth) },
    { id: "op_margin", title: "Operating margin", unit: "pct", better: "up", points: pts((x) => div(flowAt("operating_income", x), rev(x))) },
    { id: "fcf", title: "Free cash flow", unit: "money", better: "up", points: pts(fcf), note: fcfNote },
    { id: "fcf_margin", title: "Free cash flow margin", unit: "pct", better: "up", points: pts((x) => div(fcf(x), rev(x))) },
    { id: "net_cash", title: "Cash minus debt", unit: "money", better: "up", points: pts(netCash),
      note: `At each period end.${slots.some((x) => s.isAssumedPoint("total_debt", x.end)) ? " Where a balance sheet shows no borrowings line, debt is counted as 0." : ""}` },
  ];
}

/** Round axis ticks that include zero. */
function ticks(min: number, max: number): number[] {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  const range = hi - lo || Math.abs(hi) || 1;
  const raw = range / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v / step) * step);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

/** Axis labels: whole numbers where possible ($6B, $2.5B, $0, 40%). */
const tickText = (v: number, unit: Measure["unit"]) =>
  unit === "pct" ? `${Math.round(v)}%` : v === 0 ? "$0" : money(v).replace(/\.0+(?=[KMBT]|$)/, "").replace(/(\.\d*?)0+(?=[KMBT])/, "$1");

/** Column path with a 4px rounded data end and a square baseline end. */
function column(x: number, w: number, y0: number, y1: number): string {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, h, w / 2);
  if (h < 0.5) return `M${x},${y0}h${w}v-0.5h${-w}z`;
  return up
    ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
    : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function change(m: Measure, view: TrendView): string | null {
  const v = m.points.filter((p) => p.value !== null);
  if (v.length < 2) return null;
  const last = v[v.length - 1], prev = v[v.length - 2];
  const prevName = view === "annual" ? prev.label : `the ${prev.label} quarter`;
  const d = last.value! - prev.value!;
  if (m.unit === "pct") return `${d >= 0 ? "Up" : "Down"} ${Math.abs(d).toFixed(1)} pts vs. ${prevName}`;
  if (prev.value! > 0 && last.value! > 0) {
    const r = (last.value! / prev.value! - 1) * 100;
    return `${r >= 0 ? "Up" : "Down"} ${Math.abs(r).toFixed(0)}% vs. ${prevName}`;
  }
  return `${d >= 0 ? "Up" : "Down"} ${money(Math.abs(d))} vs. ${prevName}`;
}

/** How many period-to-period moves went the right way. */
function streak(m: Measure): string | null {
  const v = m.points.map((p) => p.value).filter((x): x is number => x !== null);
  if (v.length < 3) return null;
  let good = 0;
  for (let i = 1; i < v.length; i++) if (m.better === "up" ? v[i] > v[i - 1] : v[i] < v[i - 1]) good++;
  return `Improved in ${good} of ${v.length - 1} periods`;
}

function BarChart({ m, view }: { m: Measure; view: TrendView }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 150, L = 44, R = 8, T = 18, B = 22;
  const vals = m.points.map((p) => p.value).filter((x): x is number => x !== null);
  const last = [...m.points].reverse().find((p) => p.value !== null);
  if (vals.length === 0) {
    return (
      <figure className="trend">
        <figcaption><span className="t">{m.title}</span></figcaption>
        <div className="muted small trend-empty">Not enough figures yet for this view.</div>
      </figure>
    );
  }
  const tk = ticks(Math.min(...vals), Math.max(...vals));
  const lo = tk[0], hi = tk[tk.length - 1];
  const y = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  const band = (W - L - R) / m.points.length;
  const bw = Math.min(24, band * 0.62);
  const lastIdx = m.points.lastIndexOf(last!);
  const ch = change(m, view), st = streak(m);
  const hv = hover !== null ? m.points[hover] : null;

  return (
    <figure className="trend">
      <figcaption>
        <span className="t">{m.title}</span>
        <span className="v">{fmt(last!.value, m.unit)} <span className="muted small">{last!.label}</span></span>
        <span className="muted small">{[ch, st].filter(Boolean).join(" · ") || " "}</span>
      </figcaption>
      <div className="trend-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.title}: ${m.points.map((p) => `${p.label} ${fmt(p.value, m.unit)}`).join(", ")}`}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? "zero" : "grid"} />
              <text x={L - 6} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{tickText(t, m.unit)}</text>
            </g>
          ))}
          {m.points.map((p, i) => {
            const cx = L + band * i + band / 2;
            return (
              <g key={p.end}>
                {p.value !== null && <path d={column(cx - bw / 2, bw, y(0), y(p.value))} className={`bar ${p.ttm ? "ttm" : ""} ${hover === i ? "on" : ""}`} />}
                {p.value === null && <text x={cx} y={y(0) - 4} textAnchor="middle" className="tick">n/a</text>}
                <text x={cx} y={H - 6} textAnchor="middle" className="tick">{p.label}</text>
                {/* Hit target: the whole band, taller and wider than the bar. */}
                <rect x={L + band * i} y={T - 10} width={band} height={H - T - B + 10} fill="transparent"
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
                  aria-label={`${p.label}: ${fmt(p.value, m.unit)}`} />
              </g>
            );
          })}
          {last && last.value !== null && hover === null && (
            <text x={L + band * lastIdx + band / 2} y={last.value >= 0 ? y(last.value) - 5 : y(last.value) + 12} textAnchor="middle" className="cap">
              {fmt(last.value, m.unit)}
            </text>
          )}
        </svg>
        {hv && (
          <div className="trend-tip" style={{ left: `${((L + band * hover! + band / 2) / W) * 100}%` }}>
            <b>{fmt(hv.value, m.unit)}</b>
            <span>{hv.ttm ? `Last 12 months to ${hv.end}` : view === "annual" ? `Fiscal year to ${hv.end}` : `Quarter to ${hv.end}`}</span>
          </div>
        )}
      </div>
      {m.note && <div className="muted small">{m.note}</div>}
    </figure>
  );
}

export function Trends({ s, view }: { s: Series; view: TrendView }) {
  const measures = useMemo(() => buildMeasures(s, view), [s, view]);
  if (!measures[0].points.length) return null;
  return <div className="trends">{measures.map((m) => <BarChart key={m.id} m={m} view={view} />)}</div>;
}
