// Computes every number the 12 steps need from the financial rows and market data.
import { Series, toDate, toMs, yearBefore } from "./series";
import type { FinRow, Market } from "./types";

export interface AnnualRow {
  end: string;
  revenue: number | null;
  revGrowthPct: number | null;
  opIncome: number | null;
  opMarginPct: number | null;
  fcf: number | null;
  fcfMarginPct: number | null;
  cash: number | null;
  debt: number | null;
}

export interface Metrics {
  ltmEnd: string | null;
  revenueLtm: number | null;
  revGrowthPct: number | null;
  revGrowthPrevPct: number | null;
  growthBasis: string | null;
  opIncomeLtm: number | null;
  opMarginPct: number | null;
  netIncomeLtm: number | null;
  expGrowthPct: number | null;
  ocfLtm: number | null;
  capexLtm: number | null;
  fcfLtm: number | null;
  fcfMarginPct: number | null;
  interestLtm: number | null;
  interestCoverage: number | null; // Infinity when there's no interest expense and no debt
  balanceDate: string | null;
  cash: number | null;
  debt: number | null;
  netCash: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  goodwill: number | null;
  intangibles: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  equity: number | null;
  solvency: number | null; // (assets − goodwill) ÷ liabilities
  currentRatio: number | null;
  debtToEquity: number | null; // total liabilities ÷ equity
  quarterlyFcf: { end: string; value: number }[];
  quarterlyNetCash: { end: string; value: number }[];
  annual: AnnualRow[];
  ruleOf40: number | null;
  shares: number | null;
  ndrPct: number | null;
  inventoryGrowthPct: number | null;
  marketCap: number | null;
  price: number | null;
}

const pct = (a: number | null, b: number | null) =>
  a === null || b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100;
const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

export function computeMetrics(rows: FinRow[], market: Market | null): Metrics {
  const s = new Series(rows);
  const ltmRev = s.ltm("revenue");
  const end = ltmRev?.end ?? null;
  const at = (metric: string, e: string | null) => (e ? s.windowSum(metric, e) : null);

  const revenueLtm = ltmRev?.value ?? null;
  const revPrior = end ? at("revenue", yearBefore(end)) : null;
  const revPrior2 = end ? at("revenue", yearBefore(yearBefore(end))) : null;
  const opIncomeLtm = at("operating_income", end);
  const opPrior = end ? at("operating_income", yearBefore(end)) : null;
  const ocfLtm = at("operating_cash_flow", end);
  const capexLtm = at("capex", end);
  const fcfLtm = sub(ocfLtm, capexLtm);
  const interestLtm = at("interest_expense", end);

  // Growth on the best basis available (LTM, else matching YTD columns, else last two fiscal years).
  const basis = s.growthBasis("revenue");
  const revPair = basis ? s.pair("revenue", basis) : null;
  const opPair = basis ? s.pair("operating_income", basis) : null;
  const prevBasis = basis ? s.previousBasis("revenue", basis) : null;
  const prevPair = prevBasis ? s.pair("revenue", prevBasis) : null;
  const revGrowth = revPair ? pct(revPair[0], revPair[1]) : null;
  const expGrowth = revPair && opPair ? pct(revPair[0] - opPair[0], revPair[1] - opPair[1]) : null;
  void revPrior2; void opPrior; void revPrior;

  // Balance sheet: newest date that has cash.
  const cashPt = s.latestPoint("cash_and_st_investments");
  const balanceDate = cashPt?.end ?? s.latestPoint("total_assets")?.end ?? null;
  const pt = (m: string) => (balanceDate ? s.pointAt(m, balanceDate) : null);
  const cash = pt("cash_and_st_investments");
  const debt = pt("total_debt");
  const totalAssets = pt("total_assets");
  const totalLiabilities = pt("total_liabilities");
  const goodwill = pt("goodwill") ?? (totalAssets !== null ? 0 : null);
  const intangibles = pt("intangible_assets");
  const currentAssets = pt("current_assets");
  const currentLiabilities = pt("current_liabilities");
  const equity = pt("total_equity");

  // Interest coverage: LTM if interest is available for that window, else the latest fiscal year.
  let covOp = opIncomeLtm, covInt = interestLtm;
  if (covInt === null) {
    const ia = s.annual("interest_expense").at(-1);
    if (ia) {
      covInt = ia.value;
      covOp = s.annual("operating_income").find((x) => x.end === ia.end)?.value ?? null;
    }
  }
  let interestCoverage: number | null = null;
  if (covOp !== null) {
    if (covInt !== null && covInt > 0) interestCoverage = covOp / covInt;
    else if (covInt === 0 || (covInt === null && debt === 0)) interestCoverage = Infinity;
  }

  // Quarterly FCF (OCF − capex) and quarterly net cash.
  const ocfQ = s.quarters("operating_cash_flow");
  const capQ = new Map(s.quarters("capex").map((p) => [p.end, p.value]));
  const quarterlyFcf = ocfQ
    .filter((p) => capQ.has(p.end))
    .map((p) => ({ end: p.end, value: p.value - capQ.get(p.end)! }))
    .slice(-6);
  const debtPts = s.points_("total_debt");
  const quarterlyNetCash = s
    .points_("cash_and_st_investments")
    .map((c) => {
      const d = debtPts.find((x) => Math.abs(toMs(x.end) - toMs(c.end)) <= 10 * 86_400_000);
      return d ? { end: c.end, value: c.value - d.value } : null;
    })
    .filter((x): x is { end: string; value: number } => x !== null)
    .slice(-6);

  // Five-year history from annual figures.
  const revA = s.annual("revenue");
  const annual: AnnualRow[] = revA.map((r, i) => {
    const op = s.annual("operating_income").find((x) => x.end === r.end)?.value ?? null;
    const ocf = s.annual("operating_cash_flow").find((x) => x.end === r.end)?.value ?? null;
    const cap = s.annual("capex").find((x) => x.end === r.end)?.value ?? null;
    const fcf = sub(ocf, cap);
    return {
      end: r.end,
      revenue: r.value,
      revGrowthPct: i > 0 ? pct(r.value, revA[i - 1].value) : null,
      opIncome: op,
      opMarginPct: op !== null ? (op / r.value) * 100 : null,
      fcf,
      fcfMarginPct: fcf !== null ? (fcf / r.value) * 100 : null,
      cash: s.pointAt("cash_and_st_investments", r.end),
      debt: s.pointAt("total_debt", r.end),
    };
  }).slice(-6);

  const revGrowthPct = revGrowth;
  const fcfMarginPct = revenueLtm ? (fcfLtm !== null ? (fcfLtm / revenueLtm) * 100 : null) : null;

  const invNow = pt("inventory");
  const invPrior = balanceDate ? s.pointAt("inventory", yearBefore(balanceDate), 20) : null;

  const shares =
    market?.shares_outstanding ?? s.latestPoint("shares_outstanding")?.value ?? s.annual("diluted_shares").at(-1)?.value ?? null;
  const price = market?.price ?? null;
  const marketCap = market?.market_cap ?? (price !== null && shares !== null ? price * shares : null);

  return {
    ltmEnd: end,
    revenueLtm,
    revGrowthPct,
    revGrowthPrevPct: prevPair ? pct(prevPair[0], prevPair[1]) : null,
    growthBasis: basis ? (basis.kind === "ltm" ? "trailing 12 months" : basis.kind === "ytd" ? `${Math.round(basis.len! / 30.4)}-month year-to-date` : "latest fiscal year") : null,
    opIncomeLtm,
    opMarginPct: revenueLtm && opIncomeLtm !== null ? (opIncomeLtm / revenueLtm) * 100 : null,
    netIncomeLtm: at("net_income", end),
    expGrowthPct: expGrowth,
    ocfLtm,
    capexLtm,
    fcfLtm,
    fcfMarginPct,
    interestLtm,
    interestCoverage,
    balanceDate,
    cash,
    debt,
    netCash: sub(cash, debt),
    totalAssets,
    totalLiabilities,
    goodwill,
    intangibles,
    currentAssets,
    currentLiabilities,
    equity,
    solvency: totalAssets !== null && totalLiabilities ? (totalAssets - (goodwill ?? 0)) / totalLiabilities : null,
    currentRatio: ratio(currentAssets, currentLiabilities),
    debtToEquity: equity !== null && equity > 0 ? ratio(totalLiabilities, equity) : equity !== null ? Infinity : null,
    quarterlyFcf,
    quarterlyNetCash,
    annual,
    ruleOf40: revGrowthPct !== null && fcfMarginPct !== null ? revGrowthPct + fcfMarginPct : null,
    shares,
    ndrPct: s.latestPoint("ndr_pct")?.value ?? null,
    inventoryGrowthPct: pct(invNow, invPrior),
    marketCap,
    price,
  };
}

export { toDate };
