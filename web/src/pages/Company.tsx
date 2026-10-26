import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MarketPanel, Reports } from "../components/Reports";
import { DcaPanel } from "../components/DcaPanel";
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

/**
 * The "last 12 months" figures need a full year behind the newest report. When an annual report
 * is missing, they quietly fall back to an older period; say so, and say which report fixes it.
 */
function staleLtm(docs: { kind: string; period_end: string | null; extract_status: string }[], ltmEnd: string | null, lastFyEnd: string | null): string | null {
  const newest = docs.filter((d) => (d.kind === "annual" || d.kind === "quarterly") && d.extract_status === "done" && d.period_end).map((d) => d.period_end!).sort().at(-1);
  if (!newest) return null;
  const day = 86_400_000;
  if (ltmEnd && (Date.parse(newest) - Date.parse(ltmEnd)) / day < 100) return null;
  const nextFy = lastFyEnd ? `${Number(lastFyEnd.slice(0, 4)) + 1}${lastFyEnd.slice(4)}` : null;
  const need = nextFy && Date.parse(nextFy) <= Date.parse(newest) + 10 * day
    ? `the annual report for the fiscal year ending ${nextFy}`
    : "the annual report that comes before your newest quarterly report";
  return ltmEnd
    ? `The "last 12 months" figures (revenue, margins, free cash flow, growth) run to ${ltmEnd}, but your newest report runs to ${newest}. They can't be brought up to date without ${need}. Upload it to score this company on current numbers.`
    : `There isn't a full 12 months of figures yet. Upload ${need}.`;
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
  const stale = staleLtm(b.docs, m.ltmEnd, m.annual.at(-1)?.end ?? null);

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
      {!progress && stale && (
        <div className="notice row" style={{ marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{stale}</span>
          <button className="btn sm" onClick={() => setTab("data")}>Upload reports</button>
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
                    <button aria-current={sel === s.n} onClick={() => setSel(s.n)} title={s.status === "review" ? "Claude flags this step. Your call." : s.status === "expensive" ? "Priced above the bear case: see the DCA plan" : undefined}>
                      <span className="node">{s.status === "pass" ? "✓" : s.status === "review" ? "!" : s.n}</span>
                      <span className="title">{s.title}{s.overridden && <span className="muted small"> (your call)</span>}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className={`survives ${an.verdict === "survivor" ? "done" : an.verdict === "dca" ? "dca" : an.verdict === "review" ? "review" : ""}`}>
                {an.verdict === "survivor"
                  ? "Survives all 12. A company you could own for 20 years."
                  : an.verdict === "dca"
                    ? <>A business that passes. Priced high, so DCA in. <button className="btn ghost sm" onClick={() => setSel(12)}>See the plan</button></>
                    : an.verdict === "review"
                      ? `Claude flags step${an.review.length > 1 ? "s" : ""} ${an.review.join(", ")}. Your call.`
                      : `${an.passed} of 12 passed`}
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
        <div className="stack">
          <Valuation v={an.valuation} m={m} market={b.market} a={b.assessments} companyId={c.id} isSoftware={an.isSoftware} onSaved={reload} />
          <DcaPanel plan={an.dca} a={b.assessments} companyId={c.id} onSaved={reload} quality={an.steps.slice(0, 11).every((x) => x.status === "pass")} />
        </div>
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
