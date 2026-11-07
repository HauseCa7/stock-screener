import { useEffect, useMemo, useState } from "react";
import { allRunCosts, listRuns, type AiRun } from "../lib/api";
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
  const [costs, setCosts] = useState<Awaited<ReturnType<typeof allRunCosts>> | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listRuns().then(setRuns).catch((e) => setErr(e.message));
    allRunCosts().then(setCosts).catch((e) => setErr(e.message));
    supabase.from("companies").select("id, ticker").then(({ data }) => setNames(Object.fromEntries((data ?? []).map((c: any) => [c.id, c.ticker]))));
  }, []);

  const totals = useMemo(() => {
    const all = costs ?? [];
    const now = Date.now();
    const sum = (xs: typeof all) => xs.reduce((t, r) => t + Number(r.cost_usd ?? 0), 0);
    const d = new Date();
    const month = all.filter((r) => { const x = new Date(r.created_at); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); });
    const last30 = all.filter((r) => now - Date.parse(r.created_at) < 30 * 86_400_000);
    const uncosted = all.filter((r) => r.cost_usd === null && r.status === "error").length;
    // The most recent call failing for lack of credits means the balance is empty right now.
    const latest = all.at(-1);
    const outOfCredits = !!latest && latest.status === "error" && /credit/i.test(latest.error ?? "");
    return { month: sum(month), last30: sum(last30), all: sum(all), count: all.length, uncosted, outOfCredits };
  }, [costs]);

  if (err) return <div className="notice error">{err}</div>;
  if (!runs || !costs) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <h1>AI usage</h1>
      {totals.outOfCredits && (
        <div className="notice error">
          The last AI call failed because your Anthropic account is out of credits. Add credits in the Anthropic console under Billing, then run it again.
        </div>
      )}
      <div className="row" style={{ gap: 40, flexWrap: "wrap" }}>
        <div className="fact"><b>{usd(totals.month)}</b><span className="muted small">This month</span></div>
        <div className="fact"><b>{usd(totals.last30)}</b><span className="muted small">Last 30 days</span></div>
        <div className="fact"><b>{usd(totals.all)}</b><span className="muted small">All time · {totals.count} calls</span></div>
      </div>
      <p className="muted small">
        Estimated from the tokens each call used and Anthropic's published prices. This screener can't see your credit balance; the Anthropic
        console (Billing) shows it, and the exact bill. {totals.uncosted > 0 && `${totals.uncosted} older failed calls weren't costed, so the true total is somewhat higher; failed calls are costed from now on.`}
      </p>
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
