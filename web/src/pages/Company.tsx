import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MarketPanel, Reports } from "../components/Reports";
import { Financials } from "../components/Financials";
import { ScoreTable } from "../components/Scorecard";
import { StepPanel } from "../components/StepPanel";
import { Valuation } from "../components/Valuation";
import { money, pct, perShare } from "../engine/format";
import { computeMetrics } from "../engine/metrics";
import { analyze, metricsSummary } from "../engine/steps";
import { deleteCompany, draftGroup, getPrefs, GROUPS, loadCompany, refreshMarket, saveSnapshot, type Bundle, type Group, type Prefs } from "../lib/api";
import { VERDICT_LABEL } from "../lib/analyze";
import { GROUP_LABEL } from "../lib/fields";

type Tab = "steps" | "scorecard" | "financials" | "valuation" | "data";
const TABS: [Tab, string][] = [
  ["steps", "12 steps"],
  ["scorecard", "Scorecard"],
  ["financials", "Financials"],
  ["valuation", "Valuation"],
  ["data", "Reports and data"],
];

export default function CompanyPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [b, setB] = useState<Bundle | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("steps");
  const [sel, setSel] = useState(1);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setB(await loadCompany(id!));
    } catch (e: any) {
      setErr(e.message);
    }
  }, [id]);

  useEffect(() => {
    reload();
    getPrefs().then(setPrefs).catch(() => {});
  }, [reload]);

  const m = useMemo(() => (b ? computeMetrics(b.financials, b.market) : null), [b]);
  const an = useMemo(() => (b && m ? analyze(m, b.market, b.assessments) : null), [b, m]);

  // First load: open the first step that isn't passed.
  useEffect(() => {
    if (an && sel === 1 && an.steps[0].status === "pass") {
      const first = an.steps.find((s) => s.status !== "pass");
      if (first) setSel(first.n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [an?.steps.length]);

  if (err) return <div className="notice error">{err}</div>;
  if (!b || !m || !an) return <p className="muted">Loading…</p>;
  const c = b.company;
  const step = an.steps[sel - 1];

  async function draftOne(group: string) {
    setDrafting(group);
    setErr(null);
    try {
      await draftGroup(c.id, group as Group, metricsSummary(m!, b!.market, c.currency ?? "USD"), prefs.judgeModel);
      await reload();
    } catch (e: any) {
      setErr(e.message);
    }
    setDrafting(null);
  }

  async function runAll() {
    setErr(null);
    const problems: string[] = [];
    setDrafting("all");
    try {
      setProgress("Fetching market data…");
      try {
        const r = await refreshMarket(c.id);
        if (r.warnings.length) problems.push(...r.warnings);
      } catch (e: any) {
        problems.push(`Market data: ${e.message}`);
      }
      const fresh = await loadCompany(c.id);
      const summary = metricsSummary(computeMetrics(fresh.financials, fresh.market), fresh.market, c.currency ?? "USD");
      // The first call caches the documents for five minutes; the rest reuse that cache at a fraction of the cost.
      setProgress(`Claude is reading the reports: ${GROUP_LABEL.trend}…`);
      await draftGroup(c.id, "trend", summary, prefs.judgeModel);
      const rest = GROUPS.filter((g) => g !== "trend");
      let done = 0;
      setProgress(`Claude is drafting the other ${rest.length} sections…`);
      const results = await Promise.allSettled(
        rest.map((g) => draftGroup(c.id, g, summary, prefs.judgeModel).finally(() => setProgress(`Claude is drafting: ${++done} of ${rest.length} done…`))),
      );
      results.forEach((r, i) => { if (r.status === "rejected") problems.push(`${GROUP_LABEL[rest[i]]}: ${r.reason?.message ?? r.reason}`); });
      const after = await loadCompany(c.id);
      setB(after);
      const am = computeMetrics(after.financials, after.market);
      const aa = analyze(am, after.market, after.assessments);
      await saveSnapshot(c.id, { total: aa.score.total, band: aa.score.band, steps_passed: aa.passed, breakdown: aa.steps.map((s) => ({ n: s.n, status: s.status })) });
    } catch (e: any) {
      problems.push(e.message);
    }
    setProgress(null);
    setDrafting(null);
    if (problems.length) setErr(problems.join(" "));
  }

  const noDocs = b.docs.length === 0;

  return (
    <div>
      <div className="co-head">
        <div className="stack">
          <div className="row" style={{ alignItems: "baseline", gap: 14 }}>
            <h1>{c.ticker}</h1>
            <span className="muted" style={{ fontSize: 18 }}>{c.name ?? ""}</span>
            <span className={`verdict ${an.verdict}`}>{VERDICT_LABEL[an.verdict]}</span>
          </div>
          <div className="facts">
            <div className="fact"><b>{perShare(m.price)}</b><span>Share price</span></div>
            <div className="fact"><b>{money(m.marketCap)}</b><span>Market cap</span></div>
            <div className="fact"><b>{money(m.revenueLtm, c.currency ?? "USD")}</b><span>Revenue, last 12 months</span></div>
            <div className="fact"><b>{pct(m.revGrowthPct)}</b><span>Revenue growth{m.growthBasis && m.growthBasis !== "trailing 12 months" ? ` (${m.growthBasis})` : ""}</span></div>
            <div className="fact"><b>{pct(m.opMarginPct)}</b><span>Operating margin</span></div>
            <div className="fact"><b>{pct(m.fcfMarginPct)}</b><span>FCF margin</span></div>
          </div>
        </div>
        <div className="bigscore">
          <b>{an.score.total}</b><small> / 130</small>
          <div className="muted small">{an.score.band}{an.score.missing ? `, ${an.score.missing} blank` : ""}</div>
          <button className="btn primary" style={{ marginTop: 10 }} disabled={!!drafting || noDocs} onClick={runAll} title={noDocs ? "Upload reports first" : ""}>
            {drafting === "all" ? "Working…" : "Run Claude analysis"}
          </button>
        </div>
      </div>

      {progress && <div className="notice draft" style={{ marginBottom: 12 }}>{progress}</div>}
      {err && <div className="notice error" style={{ marginBottom: 12 }}>{err}</div>}
      {noDocs && tab !== "data" && (
        <div className="notice" style={{ marginBottom: 12 }}>
          No reports yet. <button className="btn sm" onClick={() => setTab("data")}>Upload reports</button>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>)}
      </div>

      {tab === "steps" && (
        <div className="journey">
          <div className="rail">
            <div>
              <ol>
                {an.steps.map((s) => (
                  <li key={s.n} className={s.status}>
                    <button aria-current={sel === s.n} onClick={() => setSel(s.n)}>
                      <span className="node">{s.status === "pass" ? "✓" : s.n}</span>
                      <span className="title">{s.title}{s.overridden && <span className="muted small"> (your call)</span>}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className={`survives ${an.verdict === "survivor" ? "done" : ""}`}>
                {an.verdict === "survivor" ? "Survives all 12. A company you could own for 20 years." : `${an.passed} of 12 passed`}
              </div>
            </div>
            <div className={`lane ${an.failed.length ? "active" : ""}`}>Off the island</div>
          </div>
          <StepPanel
            step={step}
            analysis={an}
            m={m}
            a={b.assessments}
            companyId={c.id}
            ticker={c.ticker}
            onSaved={reload}
            onDraft={draftOne}
            drafting={drafting}
            onGoto={(t) => setTab(t as Tab)}
          />
        </div>
      )}

      {tab === "scorecard" && (
        <div className="panel stack">
          <div className="row">
            <h2>Scorecard</h2>
            <span className="spacer" />
            <span className="muted small">100+ exceptional, 75–99 watchlist, under 75 no-go. Max 130 (13 × 10).</span>
          </div>
          <ScoreTable items={an.score.items} companyId={c.id} a={b.assessments} onSaved={reload} />
        </div>
      )}

      {tab === "financials" && <Financials companyId={c.id} rows={b.financials} docs={b.docs} onSaved={reload} />}

      {tab === "valuation" && (
        <Valuation v={an.valuation} m={m} market={b.market} a={b.assessments} companyId={c.id} isSoftware={an.isSoftware} onSaved={reload} />
      )}

      {tab === "data" && (
        <div className="stack">
          <Reports company={c} docs={b.docs} model={prefs.extractModel} onChanged={reload} />
          <MarketPanel company={c} market={b.market} onChanged={reload} />
          <div className="row">
            <span className="spacer" />
            <button className="btn ghost danger" onClick={async () => {
              if (!confirm(`Delete ${c.ticker} and everything about it, including uploaded reports?`)) return;
              await deleteCompany(c);
              nav("/");
            }}>Delete {c.ticker}</button>
          </div>
        </div>
      )}
    </div>
  );
}
