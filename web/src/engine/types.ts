// Shapes shared by the database layer and the scoring engine.

export interface FinRow {
  id?: string;
  metric: string;
  period_start: string | null;
  period_end: string;
  value: number | null;
  origin: "ai" | "user";
  source_doc_id?: string | null;
  source_page?: number | null;
}

export interface Market {
  price?: number | null;
  market_cap?: number | null;
  shares_outstanding?: number | null;
  forward_pe?: number | null;
  trailing_pe?: number | null;
  peg?: number | null;
  eps_growth_pct?: number | null;
  short_interest_pct?: number | null;
  institutional_pct?: number | null;
  return_5y_pct?: number | null;
  spx_return_5y_pct?: number | null;
  earnings_misses_last4?: number | null;
  field_origin?: Record<string, string>;
  fetched_at?: string | null;
}

export interface Evidence {
  quote: string;
  source?: string;
  page?: number;
}

export interface Assessment {
  key: string;
  ai_value: any;
  ai_rationale?: string | null;
  ai_evidence?: Evidence[] | null;
  ai_model?: string | null;
  ai_generated_at?: string | null;
  user_value: any;
  user_note?: string | null;
  user_updated_at?: string | null;
}

export type AssessmentMap = Record<string, Assessment>;

/** The value in force: the user's override if set, otherwise Claude's draft. */
export function eff(a: AssessmentMap, key: string): any {
  const x = a[key];
  if (!x) return undefined;
  return x.user_value !== null && x.user_value !== undefined ? x.user_value : x.ai_value;
}

export function sourceOf(a: AssessmentMap, key: string): "user" | "ai" | null {
  const x = a[key];
  if (!x) return null;
  if (x.user_value !== null && x.user_value !== undefined) return "user";
  if (x.ai_value !== null && x.ai_value !== undefined) return "ai";
  return null;
}

export type Status = "pass" | "fail" | "unknown";

export interface Check {
  label: string;
  status: Status;
  value?: string;
  detail?: string;
  source?: "computed" | "ai" | "user" | "market";
  /** Instant-kill checks are shown separately. */
  kill?: boolean;
  /** Informational checks don't affect the step result. */
  info?: boolean;
}

export interface StepResult {
  n: number;
  title: string;
  status: "pass" | "fail" | "incomplete";
  checks: Check[];
  overridden?: { status: "pass" | "fail"; reason: string } | null;
  computedStatus: "pass" | "fail" | "incomplete";
}
