import { useEffect, useState } from "react";
import { getPrefs, savePrefs, type Prefs } from "../lib/api";

const MODELS: [string, string][] = [
  ["claude-haiku-5-5", "Haiku 5.5: cheapest, fine for clean US filings"],
  ["claude-sonnet-5-5", "Sonnet 5.5: recommended balance"],
  ["claude-opus-5-5", "Opus 5.5: strongest, about 2x Sonnet's cost"],
];

export default function Settings() {
  const [p, setP] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getPrefs().then(setP).catch((e) => setErr(e.message)); }, []);
  if (!p) return err ? <div className="notice error">{err}</div> : <p className="muted">Loading…</p>;

  async function save(next: Prefs) {
    setP(next);
    setSaved(false);
    try {
      await savePrefs(next);
      setSaved(true);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <h1>Settings</h1>
      <div className="panel stack">
        <h3>Claude models</h3>
        <label className="field">Reading numbers from reports
          <select value={p.extractModel ?? "claude-sonnet-5-5"} onChange={(e) => save({ ...p, extractModel: e.target.value })}>
            {MODELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="field">Drafting judgment calls
          <select value={p.judgeModel ?? "claude-sonnet-5-5"} onChange={(e) => save({ ...p, judgeModel: e.target.value })}>
            {MODELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <p className="muted small" style={{ margin: 0 }}>Every call and its cost is listed under AI usage.</p>
        {saved && <div className="notice">Saved.</div>}
      </div>
      <div className="panel stack">
        <h3>Keys</h3>
        <p className="small" style={{ margin: 0 }}>
          The Anthropic and Alpha Vantage keys live in Supabase as secrets and never reach this page. To change them, open
          {" "}<a href="https://supabase.com/dashboard/project/mwwjyirhpxccdscoklqw/functions/secrets" target="_blank" rel="noreferrer">Supabase Edge Function secrets</a>.
        </p>
      </div>
    </div>
  );
}
