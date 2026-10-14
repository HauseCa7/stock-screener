import { useState } from "react";
import { money, pct } from "../engine/format";
import type { Metrics } from "../engine/metrics";
import type { Analysis } from "../engine/steps";
import type { AssessmentMap, Check, StepResult } from "../engine/types";
import { clearUserValue, setUserValue } from "../lib/api";
import { GROUP_LABEL, STEP_BLURB, STEP_FIELDS, STEP_GROUP, STEP_SCORES } from "../lib/fields";
import { AssessmentItem, SourceTag } from "./Assessment";
import { ScoreTable } from "./Scorecard";

function CheckRow({ c }: { c: Check }) {
  return (
    <li className={c.info ? "info" : ""}>
      <span className={`mark ${c.status}`}>{c.status === "pass" ? "✓" : c.status === "fail" ? "✕" : "?"}</span>
      <div>
        <div>{c.label} {c.info && <span className="tag">For reference</span>}</div>
        {c.detail && <div className="muted small">{c.detail}</div>}
      </div>
      <div className="val">
        {c.value}
        {c.source && c.source !== "computed" && <div><SourceTag source={c.source} /></div>}
      </div>
    </li>
  );
}

function Confirm({ companyId, k, a, label, onSaved }: { companyId: string; k: string; a: AssessmentMap; label: string; onSaved: () => void }) {
  const v = a[k]?.user_value;
  const set = async (x: boolean | null) => {
    if (x === null) await clearUserValue(companyId, k);
    else await setUserValue(companyId, k, x);
    onSaved();
  };
  return (
    <div className="row notice">
      <span style={{ flex: 1 }}>{label}</span>
      <div className="seg">
        <button aria-pressed={v === true} onClick={() => set(v === true ? null : true)}>Yes</button>
        <button aria-pressed={v === false} onClick={() => set(v === false ? null : false)}>No</button>
      </div>
    </div>
  );
}

function Override({ step, companyId, onSaved }: { step: StepResult; companyId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"pass" | "fail">(step.computedStatus === "fail" ? "pass" : "fail");
  const [reason, setReason] = useState("");
  const key = `override.step${step.n}`;
  if (step.overridden) {
    return (
      <div className="notice row">
        <span style={{ flex: 1 }}>
          You marked this step as <b>{step.overridden.status === "pass" ? "passed" : "failed"}</b>
          {step.overridden.reason ? `: ${step.overridden.reason}` : ""}. The checks alone say {step.computedStatus}.
        </span>
        <button className="btn sm" onClick={async () => { await clearUserValue(companyId, key); onSaved(); }}>Remove my override</button>
      </div>
    );
  }
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)}>Override this step's result</button>;
  return (
    <div className="editor">
      <div className="row">
        <div className="seg">
          <button aria-pressed={status === "pass"} onClick={() => setStatus("pass")}>Mark passed</button>
          <button aria-pressed={status === "fail"} onClick={() => setStatus("fail")}>Mark failed</button>
        </div>
      </div>
      <label className="field">Why (required)<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Retailer: low current ratio is normal versus peers" /></label>
      <div className="row">
        <button className="btn primary sm" disabled={!reason.trim()} onClick={async () => { await setUserValue(companyId, key, { status, reason: reason.trim() }); setOpen(false); onSaved(); }}>Save override</button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function StepPanel({
  step, analysis, m, a, companyId, ticker, onSaved, onDraft, drafting, onGoto,
}: {
  ticker: string;
  step: StepResult;
  analysis: Analysis;
  m: Metrics;
  a: AssessmentMap;
  companyId: string;
  onSaved: () => void;
  onDraft: (group: string) => void;
  drafting: string | null;
  onGoto: (tab: string) => void;
}) {
  const n = step.n;
  const normal = step.checks.filter((c) => !c.kill);
  const kills = step.checks.filter((c) => c.kill);
  const group = STEP_GROUP[n];
  const hasDraft = (STEP_FIELDS[n] ?? []).some((k) => a[k]?.ai_value !== undefined && a[k]?.ai_value !== null);
  const scoreItems = analysis.score.items.filter((i) => (STEP_SCORES[n] ?? []).includes(i.id));

  return (
    <div className="panel stack">
      <div className="step-head">
        <span className="n">{String(n).padStart(2, "0")}</span>
        <h2>{step.title}</h2>
        <span className="spacer" />
        <span className={`verdict ${step.status === "pass" ? "survivor" : step.status === "fail" ? "off_island" : "incomplete"}`}>
          {step.status === "pass" ? "Passed" : step.status === "fail" ? "Off the island" : "Not decided yet"}
        </span>
      </div>
      <p className="muted">{STEP_BLURB[n]}</p>

      <ul className="checks">{normal.map((c, i) => <CheckRow key={i} c={c} />)}</ul>
      {kills.length > 0 && (
        <div className="checks-group">
          <h4>Instant kills · any one and it's out</h4>
          <ul className="checks">{kills.map((c, i) => <CheckRow key={i} c={c} />)}</ul>
        </div>
      )}

      {n === 2 && (
        <div className="row notice">
          <span style={{ flex: 1 }}>If exactly one question fails, is there a valid reason?</span>
          <select value={a["step2.valid_reason"]?.user_value ?? ""} onChange={async (e) => {
            if (e.target.value) await setUserValue(companyId, "step2.valid_reason", e.target.value);
            else await clearUserValue(companyId, "step2.valid_reason");
            onSaved();
          }}>
            <option value="">No valid reason</option>
            <option value="infrastructure_leverage">Infrastructure that genuinely needs leverage</option>
            <option value="path_to_profitability">A clear path to profitability</option>
          </select>
        </div>
      )}

      {n === 7 && m.annual.length > 0 && (
        <div className="fin-wrap">
          <table className="fin">
            <thead><tr><th>Fiscal year</th><th>Revenue</th><th>Growth</th><th>Operating margin</th><th>Free cash flow</th><th>Cash</th><th>Debt</th></tr></thead>
            <tbody>
              {m.annual.map((r) => (
                <tr key={r.end}>
                  <td>{r.end}</td><td>{money(r.revenue)}</td><td>{pct(r.revGrowthPct)}</td><td>{pct(r.opMarginPct)}</td><td>{money(r.fcf)}</td><td>{money(r.cash)}</td><td>{money(r.debt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {n === 6 && <ScoreTable items={analysis.score.items} companyId={companyId} a={a} onSaved={onSaved} />}
      {n === 12 && <button className="btn" onClick={() => onGoto("valuation")}>Open the valuation workbench</button>}

      {group && (
        <div className="row notice draft">
          <span style={{ flex: 1 }}>
            {hasDraft
              ? <>Claude drafted the judgment calls below from your reports. Edit anything your own research disagrees with.</>
              : <>Claude hasn't drafted this step yet ({GROUP_LABEL[group]}).</>}
          </span>
          <button className="btn sm" disabled={!!drafting} onClick={() => onDraft(group)}>
            {drafting === group ? "Claude is reading…" : hasDraft ? "Draft again" : "Draft with Claude"}
          </button>
        </div>
      )}

      {(STEP_FIELDS[n] ?? []).length > 0 && (
        <div>
          {STEP_FIELDS[n].map((k) => <AssessmentItem key={k} companyId={companyId} k={k} a={a[k]} onSaved={onSaved} />)}
        </div>
      )}

      {scoreItems.length > 0 && (
        <div>
          <h3 style={{ marginTop: 8 }}>Scorecard categories from this step</h3>
          <ScoreTable items={scoreItems} companyId={companyId} a={a} onSaved={onSaved} />
        </div>
      )}

      {n === 4 && <Confirm companyId={companyId} k="confirm.step4" a={a} label="I've read this and I could explain the business to a friend." onSaved={onSaved} />}
      {n === 5 && <Confirm companyId={companyId} k="confirm.step5" a={a} label="I checked the market size myself, not just an analyst's number." onSaved={onSaved} />}
      {n === 11 && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Read the bearish analysis too:{" "}
            <a href={`https://seekingalpha.com/symbol/${ticker}/analysis`} target="_blank" rel="noreferrer">{ticker} on Seeking Alpha</a>.
          </p>
          <Confirm companyId={companyId} k="confirm.step11" a={a} label="I've read the bear case. Can I live with it?" onSaved={onSaved} />
        </>
      )}

      <Override step={step} companyId={companyId} onSaved={onSaved} />
    </div>
  );
}
