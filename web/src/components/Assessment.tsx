// One judgment item: shows the value in force, Claude's reasoning and quotes, and lets you override it.
import { useState } from "react";
import type { Assessment, Evidence } from "../engine/types";
import { clearUserValue, setUserValue } from "../lib/api";
import { FIELDS, MOAT_TYPES, type FieldKind } from "../lib/fields";

export function SourceTag({ source }: { source: "ai" | "user" | "computed" | "market" | null | undefined }) {
  if (!source) return null;
  const text = source === "ai" ? "Claude" : source === "user" ? "You" : source === "market" ? "Market data" : "Calculated";
  return <span className={`tag ${source === "ai" ? "ai" : source === "user" ? "user" : ""}`}>{text}</span>;
}

export function Why({ rationale, evidence }: { rationale?: string | null; evidence?: Evidence[] | null }) {
  if (!rationale && !evidence?.length) return null;
  return (
    <div className="why">
      {rationale}
      {(evidence ?? []).map((e, i) => (
        <q key={i}>
          {e.quote}
          {(e.source || e.page) && <cite className="muted">{[e.source, e.page ? `p. ${e.page}` : null].filter(Boolean).join(", ")}</cite>}
        </q>
      ))}
    </div>
  );
}

function Mark({ ok }: { ok: boolean | null | undefined }) {
  if (ok === null || ok === undefined) return <span className="mark unknown">?</span>;
  return <span className={`mark ${ok ? "pass" : "fail"}`}>{ok ? "✓" : "✕"}</span>;
}

export function renderValue(kind: FieldKind, v: any): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="muted">Not drafted yet</span>;
  switch (kind.t) {
    case "text":
    case "int":
      return <div className="item-value">{String(v)}</div>;
    case "bool":
      return <div>{v ? kind.yes : kind.no}</div>;
    case "score":
      return <div>{v} / 10</div>;
    case "enum":
      return <div>{kind.options.find(([k]) => k === v)?.[1] ?? String(v)}</div>;
    case "list":
      return <ol style={{ margin: 0, paddingLeft: 20 }}>{(v as string[]).map((x, i) => <li key={i}>{x}</li>)}</ol>;
    case "boolmap":
      return (
        <ul className="boolmap">
          {kind.fields.map(([k, l]) => (
            <li key={k}><Mark ok={v?.[k]} /> {l}</li>
          ))}
        </ul>
      );
    case "trimap":
      return (
        <ul className="boolmap">
          {kind.fields.map(([k, l]) => (
            <li key={k}><Mark ok={v?.[k] === "yes" ? true : v?.[k] === "no" ? false : null} /> {l}</li>
          ))}
        </ul>
      );
    case "tam":
      return (
        <div>
          <div><b>${v.estimate_usd_billions ?? "?"}B</b> market{v.growth_pct !== undefined && v.growth_pct !== null ? `, growing about ${v.growth_pct}% a year` : ""}</div>
          {v.method && <div className="muted small item-value">{v.method}</div>}
        </div>
      );
    case "ceo":
      return (
        <div>
          <b>{v.name}</b>{v.is_founder ? ", founder" : ""}{v.tenure_years ? `, ${v.tenure_years} years as CEO` : ""}
          {v.background && <div className="muted small">{v.background}</div>}
        </div>
      );
    case "moats":
      if (!Array.isArray(v) || !v.length) return <div>None identified</div>;
      return (
        <ul className="boolmap">
          {v.map((m: any, i: number) => (
            <li key={i} style={{ alignItems: "baseline" }}>
              <span className={`tag ${m.strength === "strong" ? "user" : ""}`}>{m.strength}</span>
              <span><b>{MOAT_TYPES.find(([k]) => k === m.type)?.[1] ?? m.type}</b>{m.note ? ` · ${m.note}` : ""}</span>
            </li>
          ))}
        </ul>
      );
  }
}

function Editor({ kind, initial, onSave, onCancel }: { kind: FieldKind; initial: any; onSave: (v: any, note: string) => void; onCancel: () => void }) {
  const [v, setV] = useState<any>(structuredClone(initial ?? defaultFor(kind)));
  const [note, setNote] = useState("");
  let body: React.ReactNode = null;
  switch (kind.t) {
    case "text":
      body = kind.long ? <textarea rows={4} value={v ?? ""} onChange={(e) => setV(e.target.value)} /> : <input type="text" value={v ?? ""} onChange={(e) => setV(e.target.value)} />;
      break;
    case "int":
      body = <input type="number" value={v ?? ""} onChange={(e) => setV(e.target.value === "" ? null : parseInt(e.target.value, 10))} style={{ width: 120 }} />;
      break;
    case "bool":
      body = (
        <div className="seg">
          <button type="button" aria-pressed={v === true} onClick={() => setV(true)}>{kind.yes}</button>
          <button type="button" aria-pressed={v === false} onClick={() => setV(false)}>{kind.no}</button>
        </div>
      );
      break;
    case "score":
      body = (
        <div className="seg">
          {[0, 5, 10].map((p, i) => <button type="button" key={p} aria-pressed={v === p} onClick={() => setV(p)}>{p} · {kind.bands[i]}</button>)}
        </div>
      );
      break;
    case "enum":
      body = <select value={v ?? ""} onChange={(e) => setV(e.target.value)}>{kind.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
      break;
    case "list":
      body = (
        <div className="stack">
          {(v as string[]).map((x, i) => (
            <div className="row" key={i}>
              <input type="text" style={{ flex: 1 }} value={x} onChange={(e) => setV((v as string[]).map((y, j) => (j === i ? e.target.value : y)))} />
              <button type="button" className="btn ghost sm" onClick={() => setV((v as string[]).filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => setV([...(v as string[]), ""])}>Add a reason</button>
        </div>
      );
      break;
    case "boolmap":
      body = (
        <div className="stack">
          {kind.fields.map(([k, l]) => (
            <div className="row" key={k}>
              <div className="seg">
                <button type="button" aria-pressed={v[k] === true} onClick={() => setV({ ...v, [k]: true })}>Yes</button>
                <button type="button" aria-pressed={v[k] === false} onClick={() => setV({ ...v, [k]: false })}>No</button>
              </div>
              {l}
            </div>
          ))}
        </div>
      );
      break;
    case "trimap":
      body = (
        <div className="stack">
          {kind.fields.map(([k, l]) => (
            <div className="row" key={k}>
              <div className="seg">
                {["yes", "no", "unknown"].map((o) => <button type="button" key={o} aria-pressed={v[k] === o} onClick={() => setV({ ...v, [k]: o })}>{o === "unknown" ? "?" : o === "yes" ? "Yes" : "No"}</button>)}
              </div>
              {l}
            </div>
          ))}
        </div>
      );
      break;
    case "tam":
      body = (
        <div className="grid-2">
          <label className="field">Market size ($ billions)<input type="number" value={v.estimate_usd_billions ?? ""} onChange={(e) => setV({ ...v, estimate_usd_billions: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          <label className="field">Growth per year (%)<input type="number" value={v.growth_pct ?? ""} onChange={(e) => setV({ ...v, growth_pct: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>How you sized it<textarea rows={3} value={v.method ?? ""} onChange={(e) => setV({ ...v, method: e.target.value })} /></label>
        </div>
      );
      break;
    case "ceo":
      body = (
        <div className="grid-2">
          <label className="field">Name<input type="text" value={v.name ?? ""} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
          <label className="field">Years as CEO<input type="number" value={v.tenure_years ?? ""} onChange={(e) => setV({ ...v, tenure_years: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          <label className="row small"><input type="checkbox" checked={!!v.is_founder} onChange={(e) => setV({ ...v, is_founder: e.target.checked })} /> Founder</label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>Background<textarea rows={2} value={v.background ?? ""} onChange={(e) => setV({ ...v, background: e.target.value })} /></label>
        </div>
      );
      break;
    case "moats":
      body = (
        <div className="stack">
          {MOAT_TYPES.map(([k, l]) => {
            const cur = (v as any[]).find((m) => m.type === k);
            const set = (strength: string | null) =>
              setV(strength ? [...(v as any[]).filter((m) => m.type !== k), { type: k, strength, note: cur?.note ?? "" }] : (v as any[]).filter((m) => m.type !== k));
            return (
              <div className="row" key={k}>
                <div className="seg">
                  <button type="button" aria-pressed={!cur} onClick={() => set(null)}>None</button>
                  <button type="button" aria-pressed={cur?.strength === "weak"} onClick={() => set("weak")}>Weak</button>
                  <button type="button" aria-pressed={cur?.strength === "strong"} onClick={() => set("strong")}>Strong</button>
                </div>
                {l}
              </div>
            );
          })}
        </div>
      );
      break;
  }
  return (
    <div className="editor">
      {body}
      <label className="field">Your note (optional)<input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What your own research found" /></label>
      <div className="row">
        <button type="button" className="btn primary sm" onClick={() => onSave(v, note)}>Save my answer</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function defaultFor(kind: FieldKind): any {
  switch (kind.t) {
    case "list": return [];
    case "boolmap": case "trimap": case "tam": case "ceo": return {};
    case "moats": return [];
    default: return null;
  }
}

export function AssessmentItem({ companyId, k, a, onSaved, labelOverride }: { companyId: string; k: string; a?: Assessment; onSaved: () => void; labelOverride?: string }) {
  const def = FIELDS[k];
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!def) return null;
  const hasUser = a?.user_value !== null && a?.user_value !== undefined;
  const value = hasUser ? a!.user_value : a?.ai_value;

  async function save(v: any, note: string) {
    setBusy(true);
    try {
      await setUserValue(companyId, k, v, note || null);
      setEditing(false);
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }
  async function revert() {
    setBusy(true);
    try {
      await clearUserValue(companyId, k);
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="item">
      <div className="item-head">
        <span className="label">{labelOverride ?? def.label}</span>
        <SourceTag source={hasUser ? "user" : a?.ai_value !== undefined && a?.ai_value !== null ? "ai" : null} />
        <span className="spacer" />
        {!editing && <button className="btn ghost sm" onClick={() => setEditing(true)} disabled={busy}>{value === undefined || value === null ? "Answer it" : "Edit"}</button>}
        {hasUser && a?.ai_value !== null && a?.ai_value !== undefined && !editing && (
          <button className="btn ghost sm" onClick={revert} disabled={busy}>Use Claude's draft</button>
        )}
      </div>
      {def.help && <div className="muted small" style={{ marginBottom: 4 }}>{def.help}</div>}
      {renderValue(def.kind, value)}
      {hasUser && a?.user_note && <div className="small" style={{ marginTop: 6 }}><span className="muted">Your note:</span> {a.user_note}</div>}
      {hasUser && a?.ai_value !== null && a?.ai_value !== undefined && (
        <details className="small" style={{ marginTop: 6 }}>
          <summary className="muted">Claude's draft</summary>
          {renderValue(def.kind, a.ai_value)}
        </details>
      )}
      {!editing && <Why rationale={a?.ai_rationale} evidence={a?.ai_evidence} />}
      {editing && <Editor kind={def.kind} initial={value} onSave={save} onCancel={() => setEditing(false)} />}
      {err && <div className="notice error">{err}</div>}
    </div>
  );
}
