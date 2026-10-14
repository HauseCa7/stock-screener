import { useState } from "react";
import type { ScoreItem } from "../engine/steps";
import type { AssessmentMap } from "../engine/types";
import { clearUserValue, setUserValue } from "../lib/api";
import { SourceTag, Why } from "./Assessment";

export function ScoreRow({ item, companyId, a, onSaved }: { item: ScoreItem; companyId: string; a: AssessmentMap; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = `score.${item.id}`;
  const rec = a[key];

  async function set(p: number | null) {
    setBusy(true);
    if (p === null) await clearUserValue(companyId, key);
    else await setUserValue(companyId, key, p);
    setBusy(false);
    setEditing(false);
    onSaved();
  }

  return (
    <tr>
      <td className="muted">{item.n}</td>
      <td>
        <div className="row" style={{ gap: 8 }}>
          <b style={{ fontWeight: 500 }}>{item.label}</b>
          {item.subjective && <span className="tag">Subjective</span>}
          <SourceTag source={item.source} />
        </div>
        <div className="muted small">0 · {item.bands[0]}  /  5 · {item.bands[1]}  /  10 · {item.bands[2]}</div>
        {item.subjective ? <Why rationale={rec?.ai_rationale} evidence={rec?.ai_evidence} /> : <div className="small" style={{ marginTop: 4 }}>{item.basis}</div>}
        {item.source === "user" && item.computedPoints !== null && (
          <div className="small muted" style={{ marginTop: 4 }}>{item.subjective ? "Claude" : "Calculated"}: {item.computedPoints}</div>
        )}
        {editing && (
          <div className="editor">
            <div className="seg">
              {[0, 5, 10].map((p, i) => (
                <button key={p} aria-pressed={item.points === p} disabled={busy} onClick={() => set(p)}>{p} · {item.bands[i]}</button>
              ))}
            </div>
            <div className="row">
              {item.source === "user" && <button className="btn ghost sm" onClick={() => set(null)} disabled={busy}>{item.subjective ? "Use Claude's score" : "Use the calculated score"}</button>}
              <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </td>
      <td className="pts">{item.points ?? <span className="muted">–</span>}</td>
      <td style={{ width: 70 }}>{!editing && <button className="btn ghost sm" onClick={() => setEditing(true)}>Edit</button>}</td>
    </tr>
  );
}

export function ScoreTable({ items, companyId, a, onSaved }: { items: ScoreItem[]; companyId: string; a: AssessmentMap; onSaved: () => void }) {
  return (
    <table className="score-table">
      <thead>
        <tr><th>#</th><th>Category</th><th style={{ textAlign: "center" }}>Points</th><th /></tr>
      </thead>
      <tbody>
        {items.map((it) => <ScoreRow key={it.id} item={it} companyId={companyId} a={a} onSaved={onSaved} />)}
      </tbody>
    </table>
  );
}
