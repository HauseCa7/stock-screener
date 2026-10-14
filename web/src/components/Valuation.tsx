import { useState } from "react";
import { RATES, TERMINAL_GROWTH, type Valuation as V } from "../engine/dcf";
import { num, pct, perShare } from "../engine/format";
import type { Metrics } from "../engine/metrics";
import type { AssessmentMap, Market } from "../engine/types";
import { setUserValue } from "../lib/api";

type Field = { k: string; label: string; scale: number; suffix?: string };
const FIELDS: Field[] = [
  { k: "baseRevenue", label: "Starting revenue (M)", scale: 1e6 },
  { k: "trimPct", label: "Trim on growth (%)", scale: 1 },
  { k: "growthPct", label: "Growth used (%/yr)", scale: 1 },
  { k: "fcfMarginPct", label: "FCF margin (%)", scale: 1 },
  { k: "cash", label: "Cash (M)", scale: 1e6 },
  { k: "debt", label: "Debt (M)", scale: 1e6 },
  { k: "shares", label: "Shares (M)", scale: 1e6 },
];

export function Valuation({ v, m, market, a, companyId, isSoftware, onSaved }: { v: V; m: Metrics; market: Market | null; a: AssessmentMap; companyId: string; isSoftware: boolean | null; onSaved: () => void }) {
  const saved = (a["valuation.inputs"]?.user_value ?? {}) as Record<string, number | null>;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function apply() {
    const next: Record<string, number | null> = { ...saved };
    for (const f of FIELDS) {
      if (!(f.k in draft)) continue;
      const s = draft[f.k].trim();
      next[f.k] = s === "" ? null : Number(s) * f.scale;
    }
    // Changing the trim recomputes growth unless growth itself was typed.
    if ("trimPct" in draft && !("growthPct" in draft)) next.growthPct = null;
    setBusy(true);
    await setUserValue(companyId, "valuation.inputs", next);
    setBusy(false);
    setDraft({});
    onSaved();
  }

  async function reset() {
    setBusy(true);
    await setUserValue(companyId, "valuation.inputs", {});
    setBusy(false);
    setDraft({});
    onSaved();
  }

  const peg = v.peg;
  const pegBand = peg === null ? null : peg < 1 ? "undervalued" : peg <= 1.05 ? "fair" : peg > 2 ? "very expensive" : "above fair";

  return (
    <div className="stack">
      <div className="panel stack">
        <h3>The 10-minute DCF</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Average of the last three years' growth and FCF margin, growth trimmed to stay conservative, five years of free cash flow, a {TERMINAL_GROWTH * 100}% terminal value, discounted at 8%, 10% and 12%.
          {v.inputs.rawGrowthPct !== null && ` Three-year average growth before the trim: ${pct(v.inputs.rawGrowthPct)}.`}
        </p>
        <div className="cases">
          {(["bull", "base", "bear"] as const).map((k) => {
            const c = v.cases[k];
            return (
              <div key={k} className={`case ${k}`}>
                <div className="muted small">{k === "bull" ? "Bull" : k === "base" ? "Base" : "Bear"} · {(RATES[k] * 100).toFixed(0)}% discount</div>
                <b>{perShare(c.perShare)}</b>
                <div className="small">{c.upsidePct === null ? "Needs a share price" : `${c.upsidePct >= 0 ? "+" : ""}${c.upsidePct.toFixed(0)}% vs. ${perShare(m.price)}`}</div>
              </div>
            );
          })}
        </div>
        {v.missing.length > 0 && <div className="notice">Missing: {v.missing.join(", ")}.</div>}
        <div className="grid-2">
          {FIELDS.map((f) => {
            const cur = (v.inputs as any)[f.k] as number | null;
            const isUser = saved[f.k] !== null && saved[f.k] !== undefined;
            return (
              <label key={f.k} className="field">
                <span>{f.label}{isUser && <span className="tag user" style={{ marginLeft: 6 }}>You</span>}</span>
                <input type="number" step="any" value={draft[f.k] ?? (cur === null ? "" : String(+(cur / f.scale).toFixed(2)))} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
              </label>
            );
          })}
        </div>
        <div className="row">
          <button className="btn primary" disabled={busy || !Object.keys(draft).length} onClick={apply}>Recalculate</button>
          <button className="btn ghost" disabled={busy} onClick={reset}>Back to the defaults</button>
        </div>
      </div>

      <div className="panel stack">
        <h3>Reverse DCF</h3>
        {v.impliedGrowthPct === null ? (
          <p className="muted">Needs market cap, revenue and a positive FCF margin.</p>
        ) : (
          <p>
            Today's price only makes sense if revenue grows about <b>{pct(v.impliedGrowthPct)}</b> a year for five years (at the base FCF margin and 10%).
            The company has been growing {pct(v.inputs.rawGrowthPct)}.{" "}
            {v.growthGapPct !== null && (v.growthGapPct >= 0 ? "The market is pricing in less than it delivers. That gap is where you make money." : "The market already expects more than the company delivers. No gap.")}
          </p>
        )}
      </div>

      <div className="panel stack">
        <h3>The right multiple</h3>
        <div className="grid-2">
          <div><div className="muted small">Forward P/E</div><div style={{ fontSize: 20 }}>{num(market?.forward_pe, 1)}</div><div className="muted small">Mature companies, hardware, banks: compare against peers.</div></div>
          <div><div className="muted small">PEG</div><div style={{ fontSize: 20 }}>{num(peg, 2)}</div><div className="muted small">{pegBand ? `Reads as ${pegBand}. Under 1 undervalued, 1 fair, over 2 very expensive.` : "Forward P/E ÷ EPS growth"}</div></div>
          <div><div className="muted small">Price to sales</div><div style={{ fontSize: 20 }}>{num(v.priceToSales, 1)}</div><div className="muted small">Early growth, not yet profitable: compare to the industry average.</div></div>
          <div><div className="muted small">Rule of 40</div><div style={{ fontSize: 20 }}>{m.ruleOf40 === null ? "—" : m.ruleOf40.toFixed(0)}</div><div className="muted small">{isSoftware ? "Software: tells you more than P/E." : "Mainly meaningful for software."}</div></div>
        </div>
      </div>
    </div>
  );
}
