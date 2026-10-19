import { useMemo, useState } from "react";
import { Series, toDate, toMs, yearBefore } from "../engine/series";
import type { FinRow } from "../engine/types";
import { openPdf, saveFinancial, type Doc } from "../lib/api";
import { Trends } from "./Trends";

const FLOW: [string, string][] = [
  ["revenue", "Revenue"],
  ["operating_income", "Income from operations"],
  ["net_income", "Net income"],
  ["interest_expense", "Interest expense"],
  ["operating_cash_flow", "Operating cash flow"],
  ["capex", "Capital expenditures"],
  ["diluted_eps", "Diluted EPS"],
  ["diluted_shares", "Diluted shares (M)"],
];
const POINT: [string, string][] = [
  ["cash_and_st_investments", "Cash & short-term investments"],
  ["total_debt", "Total debt"],
  ["total_assets", "Total assets"],
  ["total_liabilities", "Total liabilities"],
  ["goodwill", "Goodwill"],
  ["intangible_assets", "Intangible assets"],
  ["current_assets", "Current assets"],
  ["current_liabilities", "Current liabilities"],
  ["total_equity", "Shareholders' equity"],
  ["inventory", "Inventory"],
  ["shares_outstanding", "Shares outstanding (M)"],
  ["ndr_pct", "Net dollar retention (%)"],
];
const RAW = new Set(["diluted_eps", "ndr_pct"]);
const scale = (m: string) => (RAW.has(m) ? 1 : 1e6);
const show = (m: string, v: number | null | undefined) =>
  v === null || v === undefined ? "" : (v / scale(m)).toLocaleString(undefined, { maximumFractionDigits: RAW.has(m) ? 2 : 1 });

interface Cell {
  metric: string;
  start: string;
  end: string;
  value: number | null;
  row?: FinRow;
  derived?: boolean;
  /** Trailing-twelve-month sums are calculated, so they can't be edited directly. */
  computed?: boolean;
}

type View = "annual" | "quarterly" | "ttm";

export function Financials({ companyId, rows, docs, onSaved }: { companyId: string; rows: FinRow[]; docs: Doc[]; onSaved: () => void }) {
  const [view, setView] = useState<View>("annual");
  const [edit, setEdit] = useState<Cell | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const s = useMemo(() => new Series(rows), [rows]);
  const byKey = useMemo(() => new Map(rows.map((r) => [`${r.metric}|${r.period_start}|${r.period_end}`, r])), [rows]);
  const docById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);

  // Columns: fiscal-year ends or quarter ends.
  const cols = useMemo(() => {
    const ends = new Map<string, string>(); // end -> start of revenue-like flow
    const flowPeriods = view === "annual" ? FLOW.flatMap(([m]) => s.annual(m))
      : view === "ttm" ? FLOW.flatMap(([m]) => [...s.quarters(m), ...s.annual(m)])
      : FLOW.flatMap(([m]) => s.quarters(m));
    for (const p of flowPeriods) if (!ends.has(p.end)) ends.set(p.end, p.start);
    let list = [...ends.entries()].sort((a, b) => toMs(a[0]) - toMs(b[0])).map(([end, start]) => ({ end, start }));
    // A trailing-twelve-month column needs a full year of quarters (or a fiscal year) behind it.
    if (view === "ttm") list = list.filter((c) => s.windowSum("revenue", c.end) !== null || s.windowSum("operating_cash_flow", c.end) !== null);
    return list.slice(-8);
  }, [s, view]);

  function cellFor(metric: string, col: { end: string; start: string }, isPoint: boolean): Cell {
    if (isPoint) {
      const row = byKey.get(`${metric}|${col.end}|${col.end}`);
      const v = s.pointAt(metric, col.end, 10);
      return { metric, start: col.end, end: col.end, value: v, row };
    }
    if (view === "ttm") {
      // Weighted-average share counts don't add up across quarters; show the latest quarter's instead.
      if (metric === "diluted_shares") {
        const q = s.quarters(metric).find((x) => x.end === col.end);
        return { metric, start: col.start, end: col.end, value: q?.value ?? null, computed: true };
      }
      return { metric, start: col.start, end: col.end, value: s.windowSum(metric, col.end), computed: true };
    }
    const series = view === "annual" ? s.annual(metric) : s.quarters(metric);
    const p = series.find((x) => x.end === col.end);
    const start = p?.start ?? col.start;
    return { metric, start, end: col.end, value: p?.value ?? null, row: byKey.get(`${metric}|${start}|${col.end}`), derived: p?.derived };
  }

  async function commit() {
    if (!edit) return;
    setErr(null);
    const v = draft.trim() === "" ? null : Number(draft.replace(/,/g, ""));
    if (v !== null && !Number.isFinite(v)) return setErr("Enter a number.");
    try {
      await saveFinancial(companyId, { id: edit.row?.id, metric: edit.metric, period_start: edit.start, period_end: edit.end, value: v === null ? null : v * scale(edit.metric) });
      setEdit(null);
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const renderRow = ([m, label]: [string, string], isPoint: boolean) => (
    <tr key={m}>
      <td>{label}</td>
      {cols.map((c) => {
        const cell = cellFor(m, c, isPoint);
        const editing = edit && edit.metric === m && edit.end === cell.end && edit.start === cell.start;
        const doc = cell.row?.source_doc_id ? docById.get(cell.row.source_doc_id) : undefined;
        const title = cell.computed
          ? (m === "diluted_shares" ? "Latest quarter's weighted-average diluted shares" : `Sum of the four quarters ending ${c.end}. Edit the quarters to change it.`)
          : cell.row?.origin === "user" ? "Entered by you" : cell.derived ? "Derived from year-to-date figures" : doc ? `From ${doc.fiscal_label ?? doc.filename}${cell.row?.source_page ? `, page ${cell.row.source_page}` : ""}` : "";
        if (editing) {
          return (
            <td key={c.end}>
              <input autoFocus type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(null); }} aria-label={`${label} ${c.end}`} />
              <div className="row" style={{ justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                {doc && <button className="btn ghost sm" onClick={() => openPdf(doc, cell.row?.source_page)}>Source</button>}
                <button className="btn sm" onClick={commit}>Save</button>
              </div>
            </td>
          );
        }
        return (
          cell.computed ? (
            <td key={c.end} title={title}>{show(m, cell.value)}</td>
          ) : (
            <td key={c.end} className={`cell ${cell.row?.origin === "user" ? "user" : ""} ${cell.derived ? "derived" : ""}`} title={title}
              onClick={() => { setEdit(cell); setDraft(cell.value === null ? "" : String(cell.value / scale(m))); }}>
              {show(m, cell.value)}
            </td>
          )
        );
      })}
    </tr>
  );

  const fcf = (c: { end: string }) => {
    const o = cellFor("operating_cash_flow", { ...c, start: "" }, false).value;
    const k = cellFor("capex", { ...c, start: "" }, false).value;
    return o !== null && k !== null ? o - k : null;
  };

  return (
    <div className="stack">
      <div className="row">
        <div className="seg" role="group" aria-label="Period">
          <button aria-pressed={view === "annual"} onClick={() => setView("annual")}>Fiscal years</button>
          <button aria-pressed={view === "quarterly"} onClick={() => setView("quarterly")}>Quarters</button>
          <button aria-pressed={view === "ttm"} onClick={() => setView("ttm")}>Trailing 12 months</button>
        </div>
        <span className="muted small">
          {view === "ttm"
            ? "Millions. Each column adds up the four quarters ending that date; this is what the scorecard and pre-screen use. Balance-sheet rows show that date. To correct a number, edit it under Quarters."
            : <>Millions, in the report's currency. Click any number to correct it. Your numbers are kept when reports are re-read. <i>Italic</i> quarters are worked out from year-to-date columns.</>}
        </span>
      </div>
      {err && <div className="notice error">{err}</div>}
      {cols.length > 0 && <Trends s={s} view={view} />}
      {cols.length === 0 ? (
        <div className="panel muted">No figures yet. Upload reports on the Reports and data tab.</div>
      ) : (
        <div className="fin-wrap">
          <table className="fin">
            <thead>
              <tr><th>{view === "annual" ? "Fiscal year ending" : view === "ttm" ? "12 months ending" : "Quarter ending"}</th>{cols.map((c) => <th key={c.end}>{c.end}</th>)}</tr>
            </thead>
            <tbody>
              {FLOW.map((f) => renderRow(f, false))}
              <tr className="sub"><td>Free cash flow</td>{cols.map((c) => <td key={c.end}>{show("x", fcf(c))}</td>)}</tr>
              {view !== "quarterly" && (
                <tr className="sub"><td>Revenue growth vs. a year earlier</td>{cols.map((c) => {
                  const now = cellFor("revenue", { ...c, start: "" }, false).value;
                  const prior = view === "ttm" ? s.windowSum("revenue", yearBefore(c.end)) : s.annual("revenue").find((x) => Math.abs(toMs(x.end) - toMs(yearBefore(c.end))) <= 10 * 86_400_000)?.value ?? null;
                  return <td key={c.end}>{now !== null && prior ? `${(((now - prior) / Math.abs(prior)) * 100).toFixed(1)}%` : ""}</td>;
                })}</tr>
              )}
              <tr className="sub"><td>Operating margin</td>{cols.map((c) => {
                const r = cellFor("revenue", { ...c, start: "" }, false).value, o = cellFor("operating_income", { ...c, start: "" }, false).value;
                return <td key={c.end}>{r && o !== null ? `${((o / r) * 100).toFixed(1)}%` : ""}</td>;
              })}</tr>
              <tr><td colSpan={cols.length + 1} style={{ background: "var(--surface-2)", fontWeight: 500 }}>Balance sheet at period end</td></tr>
              {POINT.map((p) => renderRow(p, true))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { toDate };
