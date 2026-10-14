import { useEffect, useMemo, useState } from "react";
import { listRuns, type AiRun } from "../lib/api";
import { supabase } from "../lib/supabase";

const KIND: Record<string, string> = {
  extract: "Read numbers from a report",
  "draft:trend": "Draft: secular trend",
  "draft:business": "Draft: business and market",
  "draft:moat": "Draft: moat",
  "draft:management": "Draft: management",
  "draft:risks": "Draft: bear case",
};

const usd = (v: number) => `$${v.toFixed(v < 1 ? 3 : 2)}`;

export default function Usage() {
  const [runs, setRuns] = useState<AiRun[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listRuns().then(setRuns).catch((e) => setErr(e.message));
    supabase.from("companies").select("id, ticker").then(({ data }) => setNames(Object.fromEntries((data ?? []).map((c: any) => [c.id, c.ticker]))));
  }, []);

  const totals = useMemo(() => {
    const now = new Date();
    const month = (runs ?? []).filter((r) => { const d = new Date(r.created_at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); });
    const sum = (xs: AiRun[]) => xs.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    return { month: sum(month), all: sum(runs ?? []), count: runs?.length ?? 0 };
  }, [runs]);

  if (err) return <div className="notice error">{err}</div>;
  if (!runs) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <h1>AI usage</h1>
      <div className="row" style={{ gap: 40 }}>
        <div className="fact"><b>{usd(totals.month)}</b><span className="muted small">This month</span></div>
        <div className="fact"><b>{usd(totals.all)}</b><span className="muted small">Last {totals.count} calls</span></div>
      </div>
      <p className="muted small">Costs are estimated from Anthropic's published per-token prices. Your Anthropic console shows the exact bill.</p>
      {runs.length === 0 ? (
        <div className="panel muted">No AI calls yet.</div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="co-table">
            <thead><tr><th>When</th><th>Company</th><th>What</th><th>Model</th><th>Tokens in / cached / out</th><th>Cost</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ cursor: "default" }}>
                  <td className="small">{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.company_id ? names[r.company_id] ?? "—" : "—"}</td>
                  <td>{KIND[r.kind] ?? r.kind}{r.status === "error" && <div className="small" style={{ color: "var(--fail)" }}>{r.error}</div>}{r.status === "running" && <div className="small muted">Running…</div>}</td>
                  <td className="small">{r.model?.replace("claude-", "")}</td>
                  <td className="small">{r.input_tokens?.toLocaleString() ?? "—"} / {((r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0)).toLocaleString()} / {r.output_tokens?.toLocaleString() ?? "—"}</td>
                  <td>{r.cost_usd !== null ? usd(Number(r.cost_usd)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
