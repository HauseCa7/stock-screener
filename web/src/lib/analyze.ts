import { computeMetrics, type Metrics } from "../engine/metrics";
import { analyze, type Analysis } from "../engine/steps";
import type { Bundle } from "./api";

export interface Analyzed {
  metrics: Metrics;
  analysis: Analysis;
}

export function analyzeBundle(b: Bundle): Analyzed {
  const metrics = computeMetrics(b.financials, b.market);
  return { metrics, analysis: analyze(metrics, b.market, b.assessments) };
}

export const VERDICT_LABEL = {
  survivor: "Survives all 12",
  off_island: "Off the island",
  incomplete: "In progress",
} as const;
