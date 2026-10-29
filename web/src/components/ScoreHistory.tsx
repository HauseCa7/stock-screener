// Scorecard by quarter: how the 130-point score moved, and which categories moved it.
import { useEffect, useMemo, useRef } from "react";
import { changes, DATED, scoreByQuarter } from "../engine/history";
import { scoreBand } from "../engine/steps";
import type { AssessmentMap, FinRow, Market } from "../engine/types";

const pts = (v: number | null) => (v === null ? "—" : String(v));

export function ScoreHistory({ rows, market, a }: { rows: FinRow[]; market: Market | null; a: AssessmentMap }) {
  const qs = useMemo(() => scoreByQuarter(rows, market, a), [rows, market, a]);
  // Open scrolled to the newest quarter when the table is wider than the screen.
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { if (wrap.current) wrap.current.scrollLeft = wrap.current.scrollWidth; }, [qs]);
  if (qs.length < 2) {
    return (
      <div className="panel muted small">
        Score by quarter needs at least two quarters with a full 12 months of figures behind them. Upload more quarterly reports to see it.
      </div>
    );
  }
  const last = qs[qs.length - 1], prev = qs[qs.length - 2];
  const delta = last.total - prev.total;
  const moved = changes(prev, last);
  const max = 130;

  return (
    <div className="panel stack">
      <div>
        <h3>Score by quarter</h3>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          The scorecard recalculated at each quarter end, using only figures reported up to that date. Cash vs. debt, revenue growth,
          operating margin and scalability move with the reports. Claude's judgment scores and the market numbers (short interest,
          institutional ownership, 5-year return) have no history, so every quarter uses today's values for those.
        </p>
      </div>

      <div className="qs-summary">
        <span className="qs-big">{delta > 0 ? "+" : ""}{delta}</span>
        <span>
          <b>{prev.label} → {last.label}</b>: {prev.total} → {last.total} ({scoreBand(last.total)})
          <div className="muted small">
            {moved.length
              ? moved.map((c) => `${c.label} ${pts(c.from)} → ${pts(c.to)}`).join(" · ")
              : "No category changed."}
          </div>
        </span>
      </div>

      <div className="fin-wrap" ref={wrap}>
        <table className="fin qs-table">
          <thead>
            <tr>
              <th>Category</th>
              {qs.map((q) => <th key={q.end} title={`Quarter ending ${q.end}`}>{q.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="qs-total">
              <td>Total (of 130)</td>
              {qs.map((q, i) => {
                const d = i ? q.total - qs[i - 1].total : 0;
                return (
                  <td key={q.end}>
                    <div className="qs-bar" aria-hidden="true"><span style={{ width: `${(q.total / max) * 100}%` }} /></div>
                    {q.total}{d ? <span className={`qs-d ${d > 0 ? "up" : "down"}`}>{d > 0 ? ` ▲${d}` : ` ▼${-d}`}</span> : null}
                  </td>
                );
              })}
            </tr>
            {last.items.map((it) => (
              <tr key={it.id} className={DATED.has(it.id) ? "" : "qs-held"}>
                <td>{it.label}{!DATED.has(it.id) && <span className="muted small"> · today's value</span>}</td>
                {qs.map((q, i) => {
                  const cur = q.items.find((x) => x.id === it.id);
                  const before = i ? qs[i - 1].items.find((x) => x.id === it.id)?.points ?? null : null;
                  const v = cur?.points ?? null;
                  const ch = i > 0 && v !== before;
                  return (
                    <td key={q.end} className={ch ? (v !== null && before !== null && v < before ? "qs-down" : "qs-up") : undefined} title={cur?.basis}>
                      {pts(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Shaded cells changed from the quarter before. Hover a cell to see the figures behind it.</p>
    </div>
  );
}
