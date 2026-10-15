import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import { missingFields } from "../lib/marketFields";

type Tab = "steps" | "scorecard" | "financials" | "valuation" | "data";
const TABS: [Tab, string][] = [
  ["steps", "12 steps"],
  ["scorecard", "Scorecard"],
  ["financials", "Financials"],
  ["valuation", "Valuation"],
  ["data", "Reports and data"],
];

/** Fields Claude couldn't answer cleanly are left blank for the user rather than failing the whole section. */
function skippedNote(keys: string[]): string {
  const steps = [...new Set(keys.map((k) => k.split(".")[0]))].map((g) => (g.startsWith("step") ? `step ${g.slice(4)}` : g === "score" ? "the scorecard" : g));
  return `Claude's draft was saved, but ${keys.length === 1 ? "one answer" : `${keys.length} answers`} (${keys.join(", ")}) came back unusable and ${keys.length === 1 ? "was" : "were"} left blank in ${steps.join(", ")}. Fill ${keys.length === 1 ? "it" : "them"} in yourself or click Draft again.`;
}

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
  const [note, setNote] = useState<string | null>(null);

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
  const missingMarket = missingFields(b.market, m.shares);

  async function draftOne(group: string) {
    setDrafting(group);
    setErr(null);
    setNote(null);
    try {
      const r = await draftGroup(c.id, group as Group, metricsSummary(m!, b!.market, c.currency ?? "USD"), prefs.judgeModel);
      if (r.skipped?.length) setNote(skippedNote(r.skipped));
      await reload();
    } catch (e: any) {
      setErr(e.message);
    }
    setDrafting(null);
  }

  async function runAll() {
    setErr(null);
    setNote(null);
    const problems: string[] = [];
    const skipped: string[] = [];
    setDrafting("all");
    try {
      setProgress("Fetching market data…");
      // Anything that can't be fetched shows up in the "missing numbers" banner instead of as an error.
      await refreshMarket(c.id).catch(() => null);
      const fresh = await loadCompany(c.id);
      const summary = metricsSummary(computeMetrics(fresh.financials, fresh.market), fresh.market, c.currency ?? "USD");
      // The first call caches the documents for five minutes; the rest reuse that cache at a fraction of the cost.
      setProgress(`Claude is reading the reports: ${GROUP_LABEL.trend}…`);
      skipped.push(...((await draftGroup(c.id, "trend", summary, prefs.judgeModel)).skipped ?? []));
      const rest = GROUPS.filter((g) => g !== "trend");
      let done = 0;
      setProgress(`Claude is drafting the other ${rest.length} sections…`);
      const results = await Promise.allSettled(
        rest.map((g) => draftGroup(c.id, g, summary, prefs.judgeModel).finally(() => setProgress(`Claude is drafting: ${++done} of ${rest.length} done…`))),
      );
      results.forEach((r) => { if (r.status === "fulfilled") skipped.push(...(r.value.skipped ?? [])); });
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
    if (skipped.length) setNote(skippedNote(skipped));
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
      {!progress && missingMarket.length > 0 && (
        <div className="notice row" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>
            {missingMarket.length} number{missingMarket.length > 1 ? "s" : ""} from Yahoo Finance {missingMarket.length > 1 ? "are" : "is"} needed to finish the analysis: {missingMarket.map((f) => f.label.toLowerCase()).join(", ")}.
          </span>
          <Link className="btn sm primary" to={`/c/${c.id}/inputs`}>Fill them in</Link>
        </div>
      )}
      {err && <div className="notice error" style={{ marginBottom: 12 }}>{err}</div>}
      {note && <div className="notice" style={{ marginBottom: 12 }}>{note}</div>}
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
