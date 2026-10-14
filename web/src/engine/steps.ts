// The 12-step process: every check, the 130-point scorecard and the overall verdict.
import { defaultInputs, valuation, type DcfInputs, type Valuation } from "./dcf";
import { money, perShare, pct, times } from "./format";
import type { Metrics } from "./metrics";
import { eff, sourceOf, type AssessmentMap, type Check, type Market, type Status, type StepResult } from "./types";

// ---------------------------------------------------------------- helpers

const st = (c: boolean | null | undefined): Status => (c === null || c === undefined ? "unknown" : c ? "pass" : "fail");

function check(label: string, cond: boolean | null | undefined, extra: Omit<Check, "label" | "status"> = {}): Check {
  return { label, status: st(cond), ...extra };
}

function aiCheck(a: AssessmentMap, key: string, label: string, test: (v: any) => boolean | null, valueText?: (v: any) => string, extra: Partial<Check> = {}): Check {
  const v = eff(a, key);
  const src = sourceOf(a, key);
  return {
    label,
    status: v === undefined || v === null ? "unknown" : st(test(v)),
    value: v === undefined || v === null ? undefined : valueText ? valueText(v) : undefined,
    source: src ?? undefined,
    ...extra,
  };
}

const yesNo = (b: any) => (b === true ? "Yes" : b === false ? "No" : "—");
const nonEmpty = (v: any) => typeof v === "string" && v.trim().length > 0;

function resolve(n: number, title: string, checks: Check[], a: AssessmentMap): StepResult {
  const counted = checks.filter((c) => !c.info);
  const computedStatus = counted.some((c) => c.status === "fail")
    ? "fail"
    : counted.some((c) => c.status === "unknown")
      ? "incomplete"
      : "pass";
  const ov = eff(a, `override.step${n}`);
  const overridden = ov && (ov.status === "pass" || ov.status === "fail") ? { status: ov.status, reason: ov.reason ?? "" } : null;
  return { n, title, checks, computedStatus, overridden, status: overridden ? overridden.status : computedStatus };
}

// ---------------------------------------------------------------- scorecard

export interface ScoreItem {
  id: string;
  n: number;
  label: string;
  subjective: boolean;
  points: number | null; // 0/5/10, null = no data
  computedPoints: number | null;
  basis: string;
  source: "computed" | "ai" | "user" | null;
  bands: [string, string, string]; // 0, 5, 10
}

export const SCORE_DEFS: { id: string; label: string; subjective: boolean; bands: [string, string, string] }[] = [
  { id: "cash_debt", label: "Cash vs. debt", subjective: false, bands: ["More debt than cash", "More cash than debt", "2x+ cash vs. debt"] },
  { id: "revenue_growth", label: "Revenue growth", subjective: false, bands: ["Below 10%", "10 to 20%", "Above 20%"] },
  { id: "operating_margin", label: "Operating margin", subjective: false, bands: ["Below 10%", "10 to 25%", "Above 25%"] },
  { id: "short_interest", label: "Short interest", subjective: false, bands: ["Above 10%", "5 to 10%", "Below 5%"] },
  { id: "institutional", label: "Institutional ownership", subjective: false, bands: ["Below 30%", "30 to 60%", "Above 60%"] },
  { id: "rev_vs_expenses", label: "Revenue growing faster than expenses", subjective: false, bands: ["No", "—", "Yes"] },
  { id: "return_5y", label: "5-year return vs. S&P 500", subjective: false, bands: ["Underperformed (or beat by <10 pts)", "Beat by 10 to 20 pts", "Beat by 20+ pts"] },
  { id: "moat", label: "Moat", subjective: true, bands: ["None", "Weak", "Strong"] },
  { id: "ceo", label: "CEO", subjective: true, bands: ["Clown", "Decent", "Superstar"] },
  { id: "recession_proof", label: "Recession proof, pricing power", subjective: true, bands: ["None", "Some", "Strong"] },
  { id: "secular_trend", label: "Secular trend", subjective: true, bands: ["Disrupted", "Somewhat on trend", "Exactly on trend"] },
  { id: "culture", label: "Culture and mission", subjective: true, bands: ["None", "Some", "Strong"] },
  { id: "talent", label: "Talent", subjective: true, bands: ["Low", "Medium", "High"] },
];

function computedScore(id: string, m: Metrics, mk: Market | null): { points: number | null; basis: string } {
  switch (id) {
    case "cash_debt": {
      if (m.cash === null || m.debt === null) return { points: null, basis: "Needs cash and debt" };
      const p = m.debt === 0 ? (m.cash > 0 ? 10 : 5) : m.cash >= 2 * m.debt ? 10 : m.cash > m.debt ? 5 : 0;
      return { points: p, basis: `Cash ${money(m.cash)} vs. debt ${money(m.debt)}` };
    }
    case "revenue_growth": {
      const g = m.revGrowthPct;
      if (g === null) return { points: null, basis: "Needs two years of revenue" };
      return { points: g > 20 ? 10 : g >= 10 ? 5 : 0, basis: `Growth ${pct(g)}, ${m.growthBasis ?? "LTM"}` };
    }
    case "operating_margin": {
      const v = m.opMarginPct;
      if (v === null) return { points: null, basis: "Needs operating income" };
      return { points: v > 25 ? 10 : v >= 10 ? 5 : 0, basis: `LTM operating margin ${pct(v)}` };
    }
    case "short_interest": {
      const v = mk?.short_interest_pct;
      if (v === null || v === undefined) return { points: null, basis: "Enter short interest (Seeking Alpha)" };
      return { points: v < 5 ? 10 : v <= 10 ? 5 : 0, basis: `${pct(v)} of float` };
    }
    case "institutional": {
      const v = mk?.institutional_pct;
      if (v === null || v === undefined) return { points: null, basis: "Enter institutional ownership" };
      return { points: v > 60 ? 10 : v >= 30 ? 5 : 0, basis: `${pct(v)} held by institutions` };
    }
    case "rev_vs_expenses": {
      if (m.revGrowthPct === null || m.expGrowthPct === null) return { points: null, basis: "Needs revenue and operating income for two years" };
      return { points: m.revGrowthPct > m.expGrowthPct ? 10 : 0, basis: `Revenue ${pct(m.revGrowthPct)} vs. expenses ${pct(m.expGrowthPct)}` };
    }
    case "return_5y": {
      const r = mk?.return_5y_pct, s = mk?.spx_return_5y_pct;
      if (r === null || r === undefined || s === null || s === undefined) return { points: null, basis: "Needs 5-year returns" };
      const d = r - s;
      return { points: d > 20 ? 10 : d >= 10 ? 5 : 0, basis: `${pct(r, 0)} vs. S&P ${pct(s, 0)} (${d >= 0 ? "+" : ""}${d.toFixed(0)} pts)` };
    }
  }
  return { points: null, basis: "" };
}

export function scorecard(m: Metrics, mk: Market | null, a: AssessmentMap): { items: ScoreItem[]; total: number; missing: number; band: string } {
  const items = SCORE_DEFS.map((d, i): ScoreItem => {
    const key = `score.${d.id}`;
    const userV = a[key]?.user_value;
    if (d.subjective) {
      const v = eff(a, key);
      const points = typeof v === "number" ? v : null;
      return { ...d, n: i + 1, points, computedPoints: typeof a[key]?.ai_value === "number" ? a[key].ai_value : null, basis: a[key]?.ai_rationale ?? "", source: sourceOf(a, key) };
    }
    const c = computedScore(d.id, m, mk);
    const user = typeof userV === "number" ? userV : null;
    return { ...d, n: i + 1, points: user ?? c.points, computedPoints: c.points, basis: c.basis, source: user !== null ? "user" : c.points !== null ? "computed" : null };
  });
  const total = items.reduce((s, x) => s + (x.points ?? 0), 0);
  const missing = items.filter((x) => x.points === null).length;
  return { items, total, missing, band: scoreBand(total) };
}

export function scoreBand(total: number): string {
  return total >= 100 ? "Exceptional" : total >= 75 ? "Watchlist" : "No-go";
}

// ---------------------------------------------------------------- the 12 steps

export interface Analysis {
  steps: StepResult[];
  score: ReturnType<typeof scorecard>;
  valuation: Valuation;
  passed: number;
  failed: number[];
  verdict: "survivor" | "off_island" | "incomplete";
  isSoftware: boolean | null;
}

export function analyze(m: Metrics, mk: Market | null, a: AssessmentMap, now = new Date()): Analysis {
  const isSoftware: boolean | null = eff(a, "fact.is_software") ?? null;
  const founded: number | null = eff(a, "fact.founded_year") ?? null;
  const age = founded ? now.getUTCFullYear() - founded : null;
  const score = scorecard(m, mk, a);
  const scoreOf = (id: string) => score.items.find((x) => x.id === id)?.points ?? null;
  const steps: StepResult[] = [];

  // 1. Secular trend
  {
    const tc = eff(a, "step1.trend_checks") ?? {};
    const tsrc = sourceOf(a, "step1.trend_checks") ?? undefined;
    const labels: [string, string][] = [
      ["real_demand", "Real demand and paying customers"],
      ["sustainable_growth", "Sustainable revenue and earnings growth"],
      ["moat_not_commodity", "A moat, not a commodity"],
      ["tailwinds", "Regulatory or government tailwinds"],
      ["visible_adoption", "Adoption you can see in the real world"],
    ];
    const answered = labels.filter(([k]) => typeof tc[k] === "boolean");
    const passedN = labels.filter(([k]) => tc[k] === true).length;
    const failedL = labels.filter(([k]) => tc[k] === false).map(([, l]) => l.toLowerCase());
    const checks: Check[] = [{
      label: "Passes all five trend tests",
      status: failedL.length ? "fail" : answered.length === 5 ? "pass" : "unknown",
      value: answered.length ? `${passedN} of 5` : undefined,
      detail: failedL.length ? `Fails: ${failedL.join("; ")}` : undefined,
      source: tsrc,
    }];
    checks.push(aiCheck(a, "step1.gap", "A real gap between the market's story and what it's becoming", (v) => v === true, yesNo));
    checks.push(aiCheck(a, "step1.skip_zone", "Not in a skip zone", (v) => v === "none", (v) => (v === "none" ? "None" : String(v).replace("_", " "))));
    steps.push(resolve(1, "Find the secular trend", checks, a));
  }

  // 2. Sanity check (pass 2 of 3; a single fail needs a valid reason)
  {
    const g = m.annual.map((r) => r.revGrowthPct).filter((x): x is number => x !== null).slice(-3);
    const grew = g.length >= 2 ? g.every((x) => x > 0) : null;
    const prof = m.opIncomeLtm === null ? null : m.opIncomeLtm > 0;
    const cashDebt = m.cash === null || m.debt === null ? null : m.cash > m.debt;
    const checks: Check[] = [
      check("Revenue has grown for the past few years", grew, { value: g.length ? g.map((x) => pct(x, 0)).join(", ") : undefined, source: "computed", info: true }),
      check("The company is profitable (operating income, LTM)", prof, { value: money(m.opIncomeLtm), source: "computed", info: true }),
      check("More cash than debt", cashDebt, { value: m.cash !== null ? `${money(m.cash)} vs. ${money(m.debt)}` : undefined, source: "computed", info: true }),
    ];
    const passes = [grew, prof, cashDebt].filter((x) => x === true).length;
    const fails = [grew, prof, cashDebt].filter((x) => x === false).length;
    const reason: string | null = eff(a, "step2.valid_reason") ?? null;
    let verdict: boolean | null;
    if (fails === 0) verdict = passes === 3 ? true : null;
    else if (fails === 1) verdict = passes === 2 ? !!reason : null;
    else verdict = false;
    checks.push(check(fails === 1 ? "Two of three pass, and the failure has a valid reason" : "At least two of three pass", verdict, {
      value: fails === 1 ? (reason ? reasonLabel(reason) : "No valid reason given") : `${passes} of 3`,
      detail: fails === 1 ? "Valid reasons: an infrastructure company that genuinely needs leverage, or a clear path to profitability." : undefined,
      source: fails === 1 && reason ? "user" : "computed",
    }));
    steps.push(resolve(2, "Sanity check", checks, a));
  }

  // 3. Pre-screen
  {
    const qf = m.quarterlyFcf.slice(-6);
    const qn = m.quarterlyNetCash.slice(-6);
    const moat = scoreOf("moat");
    const c01 = eff(a, "step10.checklist")?.c01_track_record;
    const legal = eff(a, "step3.legal_overhang");
    const r40Pass = m.ruleOf40 === null ? null : m.ruleOf40 >= 40;
    const falling = m.revGrowthPct !== null && m.revGrowthPrevPct !== null ? m.revGrowthPct < 10 && m.revGrowthPct < m.revGrowthPrevPct : m.revGrowthPct !== null && m.revGrowthPct >= 10 ? false : null;
    const mc = m.marketCap;
    const si = mk?.short_interest_pct ?? null;
    const misses = mk?.earnings_misses_last4 ?? null;
    const checks: Check[] = [
      check("Positive free cash flow, last 4–6 quarters", qf.length >= 4 ? qf.every((x) => x.value > 0) : null, { value: qf.length ? `${qf.filter((x) => x.value > 0).length} of ${qf.length} positive` : "Upload quarterly reports", source: "computed" }),
      check("Net cash positive, last 4–6 quarters", qn.length >= 4 ? qn.every((x) => x.value > 0) : null, { value: qn.length ? `${qn.filter((x) => x.value > 0).length} of ${qn.length} positive` : "Upload quarterly reports", source: "computed" }),
      check("Revenue growing 10% or more", m.revGrowthPct === null ? null : m.revGrowthPct >= 10, { value: pct(m.revGrowthPct), source: "computed" }),
      check("An actual moat", moat === null ? null : moat >= 5, { value: moat === null ? undefined : `${moat}/10 on scorecard`, source: sourceOf(a, "score.moat") ?? undefined }),
      check("A CEO and team with a track record", c01 === undefined || c01 === "unknown" ? null : c01 === "yes", { value: c01, source: sourceOf(a, "step10.checklist") ?? undefined }),
      check("No major regulatory or legal overhang", legal === undefined || legal === null ? null : legal === false, { value: legal === true ? "Overhang present" : legal === false ? "None found" : undefined, source: sourceOf(a, "step3.legal_overhang") ?? undefined }),
      check("Test A · Rule of 40 (growth % + FCF margin %)", isSoftware === false ? r40Pass : r40Pass, {
        value: m.ruleOf40 === null ? undefined : m.ruleOf40.toFixed(0),
        detail: isSoftware === false ? "Shown for reference — it only counts for software and subscription businesses." : undefined,
        info: isSoftware !== true,
        source: "computed",
      }),
      check("Test B · Scalability: revenue grows faster than expenses", m.revGrowthPct === null || m.expGrowthPct === null ? null : m.revGrowthPct > m.expGrowthPct, { value: m.revGrowthPct !== null ? `${pct(m.revGrowthPct)} vs. ${pct(m.expGrowthPct)}` : undefined, source: "computed" }),
      // Instant kills
      check("Market cap at least $1 billion", mc === null ? null : mc >= 1e9, { value: money(mc), kill: true, source: "market" }),
      check("Short interest at or below 10%", si === null ? null : si <= 10, { value: pct(si), kill: true, source: "market" }),
      check("No more debt than cash, not even by a dollar", m.cash === null || m.debt === null ? null : m.debt <= m.cash, { value: `${money(m.cash)} vs. ${money(m.debt)}`, kill: true, source: "computed" }),
      check("Operating margin at least 20%", m.opMarginPct === null ? null : m.opMarginPct >= 20, { value: pct(m.opMarginPct), kill: true, source: "computed" }),
      check("Not: revenue growth below 10% and falling", falling === null ? null : !falling, { value: m.revGrowthPrevPct !== null ? `${pct(m.revGrowthPct)} (prior year ${pct(m.revGrowthPrevPct)})` : pct(m.revGrowthPct), kill: true, source: "computed" }),
      check("Fewer than 2 earnings misses in the last 4 quarters", misses === null ? null : misses < 2, { value: misses === null ? undefined : `${misses} misses`, kill: true, source: "market" }),
      check("At least 10 years old (from founding)", age === null ? null : age >= 10, { value: founded ? `Founded ${founded}` : undefined, kill: true, source: sourceOf(a, "fact.founded_year") ?? undefined }),
    ];
    steps.push(resolve(3, "Pre-screen", checks, a));
  }

  // 4. Define the business
  {
    const checks: Check[] = [
      aiCheck(a, "step4.sentence", "The one-sentence definition comes out clean", nonEmpty),
      aiCheck(a, "step4.pain", "What pain are we curing?", nonEmpty),
      aiCheck(a, "step4.who", "Who's in pain, and why?", nonEmpty),
      aiCheck(a, "step4.why_us", "Why will customers come to us, not the competitor?", nonEmpty),
      { label: "I've read it and I understand this business", status: a["confirm.step4"]?.user_value === true ? "pass" : a["confirm.step4"]?.user_value === false ? "fail" : "unknown", source: "user" },
    ];
    steps.push(resolve(4, "Define the business", checks, a));
  }

  // 5. Market potential
  {
    const checks: Check[] = [
      aiCheck(a, "step5.broad_market", "Sells into a broad market, not a niche", (v) => v === true, yesNo),
      aiCheck(a, "step5.big_enough", "The market is big enough to support the growth", (v) => v === true, yesNo),
      { label: "I checked the market size myself", status: a["confirm.step5"]?.user_value === true ? "pass" : a["confirm.step5"]?.user_value === false ? "fail" : "unknown", source: "user" },
    ];
    steps.push(resolve(5, "Market potential", checks, a));
  }

  // 6. Scorecard
  {
    const best = score.total + score.missing * 10;
    const cond = score.total >= 75 ? true : best < 75 ? false : null;
    const checks: Check[] = [check("Scores 75 or more (out of 130)", cond, {
      value: `${score.total}${score.missing ? ` (+${score.missing} blank)` : ""} · ${score.band}`,
      detail: score.missing ? `${score.missing} categories have no data yet.` : undefined,
      source: "computed",
    })];
    steps.push(resolve(6, "125-point scorecard", checks, a));
  }

  // 7. Revenue engine & 5-year history
  {
    const yrs = m.annual;
    const enough = yrs.length >= 3;
    const revs = yrs.map((r) => r.revenue);
    const revUp = enough ? revs.every((v, i) => i === 0 || (v !== null && revs[i - 1] !== null && v > revs[i - 1]!)) : null;
    const om = yrs.map((r) => r.opMarginPct).filter((x): x is number => x !== null);
    const omUp = om.length >= 3 ? om[om.length - 1] > om[0] : null;
    const fcf = yrs.map((r) => r.fcf);
    const fcfOk = enough && fcf.every((x) => x !== null) ? fcf.every((x) => x! > 0) && fcf[fcf.length - 1]! > fcf[0]! : null;
    const cd = yrs.filter((r) => r.cash !== null && r.debt !== null);
    const cdOk = cd.length >= 3 ? cd.every((r) => r.cash! > r.debt!) : null;
    const span = yrs.length ? `${yrs.length} years` : "no annual data";
    const checks: Check[] = [
      aiCheck(a, "step7.revenue_engine", "Understand how the money gets made", nonEmpty, undefined, { info: true }),
      check("Revenue growing every year", revUp, { value: span, source: "computed" }),
      check("Operating margin expanding", omUp, { value: om.length ? `${pct(om[0])} → ${pct(om[om.length - 1])}` : undefined, source: "computed" }),
      check("Free cash flow positive and rising", fcfOk, { value: fcf.length && fcf[0] !== null ? `${money(fcf[0])} → ${money(fcf[fcf.length - 1])}` : undefined, source: "computed" }),
      check("More cash than debt, every year", cdOk, { value: `${cd.length} year-ends checked`, source: "computed" }),
    ];
    if (isSoftware) {
      checks.push(check("Net dollar retention 120% or higher", m.ndrPct === null ? null : m.ndrPct >= 120, { value: m.ndrPct === null ? "Not disclosed" : pct(m.ndrPct, 0), info: m.ndrPct === null, source: "computed" }));
    }
    steps.push(resolve(7, "Revenue engine and 5-year history", checks, a));
  }

  // 8. Loan Officer Test
  {
    const checks: Check[] = [
      check("Interest coverage 4x or more", m.interestCoverage === null ? null : m.interestCoverage >= 4, { value: times(m.interestCoverage), detail: "Operating income ÷ interest expense", source: "computed" }),
      check("Assets to liabilities at least 2:1 (excl. goodwill)", m.solvency === null ? null : m.solvency >= 2, { value: m.solvency === null ? undefined : `${m.solvency.toFixed(2)}:1${m.solvency >= 3 ? " (ideal)" : ""}`, source: "computed" }),
      check("Current ratio 1.0 or more", m.currentRatio === null ? null : m.currentRatio >= 1, { value: times(m.currentRatio, 2), source: "computed" }),
      check("Debt-to-equity below 4x", m.debtToEquity === null ? null : m.debtToEquity < 4, { value: times(m.debtToEquity, 2), detail: "Total liabilities ÷ shareholders' equity", source: "computed" }),
    ];
    steps.push(resolve(8, "Loan Officer Test", checks, a));
  }

  // 9. Moat
  {
    const moats = eff(a, "step9.moats");
    const checks: Check[] = [
      aiCheck(a, "step9.moats", "Has at least one of the six moats", (v) => Array.isArray(v) && v.length > 0, (v) => (Array.isArray(v) && v.length ? v.map((x: any) => `${String(x.type).replace("_", " ")} (${x.strength})`).join(", ") : "None")),
      aiCheck(a, "step9.direction", "Moat is not getting weaker", (v) => v !== "weakening", (v) => String(v)),
      aiCheck(a, "step9.copyable", "Can't be copied in a year with 20x the engineers", (v) => v === false, (v) => (v ? "Copyable" : "Not copyable")),
      check("Operating margin proves pricing power (20%+)", m.opMarginPct === null ? null : m.opMarginPct >= 20, { value: pct(m.opMarginPct), source: "computed" }),
    ];
    void moats;
    steps.push(resolve(9, "Competitive moat", checks, a));
  }

  // 10. Management
  {
    const cl = eff(a, "step10.checklist") ?? {};
    const yes = Object.values(cl).filter((v) => v === "yes").length;
    const rf = eff(a, "step10.red_flags");
    const ceo = scoreOf("ceo");
    const checks: Check[] = [
      check("Amazed by the CEO (scorecard CEO = 10)", ceo === null ? null : ceo === 10, { value: ceo === null ? undefined : `${ceo}/10`, source: sourceOf(a, "score.ceo") ?? undefined }),
      check("CEO checklist: at least 6 of 8", Object.keys(cl).length ? yes >= 6 : null, { value: Object.keys(cl).length ? `${yes} of 8` : undefined, source: sourceOf(a, "step10.checklist") ?? undefined }),
      check("No instant red flags (clown CEO, co-CEOs, acquisition spree)", rf ? !(rf.clown_ceo || rf.co_ceo || rf.acquisition_spree) : null, { value: rf ? [rf.clown_ceo && "clown CEO", rf.co_ceo && "co-CEO", rf.acquisition_spree && "acquisition spree"].filter(Boolean).join(", ") || "None" : undefined, source: sourceOf(a, "step10.red_flags") ?? undefined }),
    ];
    steps.push(resolve(10, "Management", checks, a));
  }

  // 11. Destroy something beautiful
  {
    const rf = eff(a, "step11.red_flags") ?? null;
    const hype = eff(a, "step11.hype_trap") ?? null;
    const om = m.annual.map((r) => r.opMarginPct).filter((x): x is number => x !== null);
    const declining = om.length >= 2 ? om[om.length - 1] < om[om.length - 2] : null;
    const invSpike = m.inventoryGrowthPct !== null && m.revGrowthPct !== null ? m.inventoryGrowthPct > 20 && m.inventoryGrowthPct > 2 * Math.max(m.revGrowthPct, 0) : m.inventoryGrowthPct === null ? false : null;
    const rfFail = rf ? Object.entries(rf).filter(([, v]) => v === "yes").map(([k]) => k.replace(/_/g, " ")) : null;
    const checks: Check[] = [
      aiCheck(a, "step11.reasons_wrong", "3 to 5 reasons the thesis is wrong, written down", (v) => Array.isArray(v) && v.length >= 3, (v) => `${(v ?? []).length} reasons`),
      aiCheck(a, "step11.bear_case", "A short bear case in plain words", nonEmpty),
      check("No research-ending red flags (fraud, auditor change, insider selling, over-expansion)", rf ? rfFail!.length === 0 : null, { value: rfFail ? (rfFail.length ? rfFail.join(", ") : "None") : undefined, source: sourceOf(a, "step11.red_flags") ?? undefined }),
      check("Margins not declining (latest year vs. prior)", declining === null ? null : !declining, { value: om.length >= 2 ? `${pct(om[om.length - 2])} → ${pct(om[om.length - 1])}` : undefined, source: "computed" }),
      check("No revenue spike with inventory piling up", invSpike === null ? null : !invSpike, { value: m.inventoryGrowthPct !== null ? `Inventory ${pct(m.inventoryGrowthPct)} vs. revenue ${pct(m.revGrowthPct)}` : "No inventory reported", source: "computed" }),
      check("Not a hype trap (all four signals at once)", hype ? !(hype.no_revenue && hype.weak_fundamentals && hype.constant_share_sales && hype.media_hype) : null, { value: hype ? `${[hype.no_revenue, hype.weak_fundamentals, hype.constant_share_sales, hype.media_hype].filter(Boolean).length} of 4 signals` : undefined, source: sourceOf(a, "step11.hype_trap") ?? undefined }),
      { label: "I read the bear case and I can live with it", status: a["confirm.step11"]?.user_value === true ? "pass" : a["confirm.step11"]?.user_value === false ? "fail" : "unknown", source: "user" },
    ];
    steps.push(resolve(11, "Destroy something beautiful", checks, a));
  }

  // 12. Valuation
  const val = valuation(m, mergeInputs(defaultInputs(m, a["valuation.inputs"]?.user_value?.trimPct ?? 20), a["valuation.inputs"]?.user_value), mk);
  {
    const bear = val.cases.bear.perShare;
    const checks: Check[] = [
      check("Even the bear case (12%) is worth more than today's price", bear === null || m.price === null ? null : bear > m.price, {
        value: bear !== null && m.price !== null ? `${perShare(bear)} vs. ${perShare(m.price)}` : val.missing.length ? `Missing: ${val.missing.join(", ")}` : undefined,
        source: "computed",
      }),
      check("Market isn't pricing in more growth than the company delivers", val.growthGapPct === null ? null : val.growthGapPct >= 0, {
        value: val.impliedGrowthPct !== null ? `Implied ${pct(val.impliedGrowthPct)} vs. actual ${pct(val.inputs.rawGrowthPct)}` : undefined,
        detail: "Reverse DCF: the growth today's price needs, at 10%.",
        info: true,
        source: "computed",
      }),
    ];
    steps.push(resolve(12, "Valuation", checks, a));
  }

  const failed = steps.filter((s) => s.status === "fail").map((s) => s.n);
  const passed = steps.filter((s) => s.status === "pass").length;
  const verdict = failed.length ? "off_island" : passed === 12 ? "survivor" : "incomplete";
  return { steps, score, valuation: val, passed, failed, verdict, isSoftware };
}

function reasonLabel(r: string): string {
  return r === "infrastructure_leverage" ? "Infrastructure that genuinely needs leverage" : r === "path_to_profitability" ? "Clear path to profitability" : r;
}

export function mergeInputs(base: DcfInputs, user: Partial<DcfInputs> | null | undefined): DcfInputs {
  if (!user) return base;
  const out = { ...base };
  for (const k of Object.keys(user) as (keyof DcfInputs)[]) {
    const v = user[k];
    if (v !== null && v !== undefined && v !== ("" as any)) (out as any)[k] = v;
  }
  // If the user changed only the trim, recompute trimmed growth from the raw average.
  if (user.trimPct !== undefined && (user.growthPct === undefined || user.growthPct === null) && out.rawGrowthPct !== null) {
    out.growthPct = out.rawGrowthPct * (1 - out.trimPct / 100);
  }
  return out;
}

/** Plain-text summary of the computed numbers, given to Claude alongside the documents. */
export function metricsSummary(m: Metrics, mk: Market | null, currency = "USD"): string {
  const L: string[] = [];
  L.push(`LTM period ending ${m.ltmEnd ?? "?"}: revenue ${money(m.revenueLtm, currency)}, growth ${pct(m.revGrowthPct)} (prior year ${pct(m.revGrowthPrevPct)})`);
  L.push(`Operating margin ${pct(m.opMarginPct)}, FCF ${money(m.fcfLtm, currency)} (margin ${pct(m.fcfMarginPct)}), net income ${money(m.netIncomeLtm, currency)}`);
  L.push(`Cash ${money(m.cash, currency)}, debt ${money(m.debt, currency)}, interest coverage ${times(m.interestCoverage)}, current ratio ${times(m.currentRatio, 2)}`);
  L.push(`Revenue growth vs expense growth: ${pct(m.revGrowthPct)} vs ${pct(m.expGrowthPct)}; Rule of 40: ${m.ruleOf40?.toFixed(0) ?? "—"}`);
  if (m.annual.length) {
    L.push("Annual history: " + m.annual.map((r) => `${r.end.slice(0, 4)}: rev ${money(r.revenue, currency)}, op margin ${pct(r.opMarginPct)}, FCF ${money(r.fcf, currency)}`).join(" | "));
  }
  if (mk) {
    L.push(`Market cap ${money(m.marketCap)}, price ${money(m.price)}, forward P/E ${mk.forward_pe ?? "—"}, 5y return ${pct(mk.return_5y_pct, 0)} vs S&P ${pct(mk.spx_return_5y_pct, 0)}, earnings misses (last 4q) ${mk.earnings_misses_last4 ?? "—"}`);
  }
  return L.join("\n");
}
