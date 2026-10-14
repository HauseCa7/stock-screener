import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { money } from "../engine/format";
import { createCompany, loadEverything, type Bundle } from "../lib/api";
import { analyzeBundle, VERDICT_LABEL } from "../lib/analyze";

type Filter = "all" | "survivor" | "incomplete" | "off_island";

export default function Companies() {
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const nav = useNavigate();

  useEffect(() => {
    loadEverything().then(setBundles).catch((e) => setErr(e.message));
  }, []);

  const rows = useMemo(
    () =>
      (bundles ?? [])
        .map((b) => ({ b, ...analyzeBundle(b) }))
        .sort((x, y) => y.analysis.score.total - x.analysis.score.total),
    [bundles],
  );
  const shown = rows.filter((r) => filter === "all" || r.analysis.verdict === filter);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await createCompany(ticker, symbol);
      nav(`/c/${c.id}`);
    } catch (e: any) {
      setErr(/duplicate/i.test(e.message) ? `${ticker.toUpperCase()} is already on your list.` : e.message);
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "end", marginBottom: 8 }}>
        <div>
          <h1>Companies</h1>
          <p className="muted" style={{ margin: 0 }}>Every company runs the same twelve steps. Sorted by scorecard total.</p>
        </div>
        <span className="spacer" />
        <form className="row" onSubmit={add}>
          <label className="field">Ticker<input type="text" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="NVDA" style={{ width: 110 }} /></label>
          <label className="field" title="Only needed for non-US listings, e.g. SHOP.TRT for Shopify on the TSX">
            Market-data symbol (optional)<input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="SHOP.TRT" style={{ width: 150 }} />
          </label>
          <button className="btn primary" disabled={busy || !ticker.trim()} style={{ alignSelf: "end" }}>Add company</button>
        </form>
      </div>
      {err && <div className="notice error">{err}</div>}

      {bundles && bundles.length > 0 && (
        <div className="seg" role="group" aria-label="Filter">
          {(["all", "survivor", "incomplete", "off_island"] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? `All (${rows.length})` : `${VERDICT_LABEL[f]} (${rows.filter((r) => r.analysis.verdict === f).length})`}
            </button>
          ))}
        </div>
      )}

      {bundles === null && !err && <p className="muted">Loading…</p>}
      {bundles && bundles.length === 0 && (
        <div className="panel">
          <h3>Start with your first company</h3>
          <p className="muted">Add a ticker above, then upload its last three annual reports and last four quarterly reports. The tool reads the numbers, Claude drafts the judgment calls, and you correct anything you disagree with.</p>
        </div>
      )}

      {shown.length > 0 && (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="co-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Steps</th>
                <th>Score</th>
                <th className="hide-sm">Market cap</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ b, analysis: a, metrics: m }) => (
                <tr key={b.company.id} onClick={() => nav(`/c/${b.company.id}`)}>
                  <td>
                    <div className="ticker">{b.company.ticker}</div>
                    <div className="muted small">{b.company.name ?? "Name appears after the first report is read"}</div>
                  </td>
                  <td>
                    <span className="trail" aria-label={`${a.passed} of 12 steps passed`}>
                      {a.steps.map((s) => <i key={s.n} className={s.status} title={`${s.n}. ${s.title}: ${s.status}`} />)}
                    </span>
                    <div className="muted small">{a.passed} of 12 passed</div>
                  </td>
                  <td>
                    <div className="scorebar">
                      <span><b>{a.score.total}</b> <span className="muted small">/ 130 · {a.score.band}</span></span>
                      <span className="bar"><span style={{ width: `${(a.score.total / 130) * 100}%` }} /></span>
                    </div>
                  </td>
                  <td className="hide-sm">{money(m.marketCap)}</td>
                  <td><span className={`verdict ${a.verdict}`}>{VERDICT_LABEL[a.verdict]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
