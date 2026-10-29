import { statisticalRisk, behaviorRisk, behaviorBreakdown } from "./statistics.ts";

export const MODEL_VERSION = "hfi-2.3.3";
export const SCORE_WEIGHTS = { statistical: 0.40, referral_ring: 0.30, network: 0.20, behavior: 0.10 } as const;
export const RISK_THRESHOLDS = { critical: 80, high: 60, medium: 35 } as const;
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Referral-ring heuristic for a cyclic SCC containing at least three providers.
 * When referral events exist but no qualifying ring is detected, the observed ring signal is 0.
 * Null means there is no incident referral evidence with which to assess this component.
 */
export function ringRisk(graphSignal: any, component: any): number | null {
  if (!graphSignal || Number(graphSignal.incident_referral_events || 0) === 0) return null;
  if (!graphSignal.ring_detected || !component?.ring_detected || Number(component.size) < 3) return 0;
  const size = Number(component.size);
  const possibleEdges = size * (size - 1);
  // Self-loops are real events but are not inter-provider connections and must not inflate density.
  const interProviderEdges = (Array.isArray(component.internal_edges) ? component.internal_edges : [])
    .filter((edge: any) => edge.from_provider !== edge.to_provider);
  const density = possibleEdges ? interProviderEdges.length / possibleEdges : 0;
  const repeatedInterProviderEvents = interProviderEdges.reduce((sum: number, edge: any) => sum + Math.max(0, Number(edge.event_count || 0) - 1), 0);
  const repeatBonus = Math.min(10, repeatedInterProviderEvents * 2);
  // Maximum is 35 + 30*1 + 10 = 75 because density is bounded by 1.
  return round(clamp(35 + 30 * density + repeatBonus, 0, 75));
}

export function networkRisk(graphSignal: any, maxPageRank: number, maxIncidentEvents: number): number | null {
  if (!graphSignal || Number(graphSignal.incident_referral_events || 0) === 0) return null;
  const centrality = maxPageRank > 0 ? clamp(Number(graphSignal.pagerank || 0) / maxPageRank * 100) : 0;
  const activity = maxIncidentEvents > 0 ? clamp(Number(graphSignal.incident_referral_events || 0) / maxIncidentEvents * 100) : 0;
  return round(0.6 * centrality + 0.4 * activity);
}

/**
 * Return the effective weight for each component as a fraction of the final score.
 * A null component is excluded; observed zero is a real score and retains its weight.
 */
export function effectiveComponentWeights(components: { statistical: number | null; referral_ring: number | null; network: number | null; behavior: number | null }): Record<keyof typeof SCORE_WEIGHTS, number | null> {
  const pairs = Object.entries(SCORE_WEIGHTS) as [keyof typeof SCORE_WEIGHTS, number][];
  const available = pairs.filter(([key]) => components[key] !== null && components[key] !== undefined && Number.isFinite(components[key]));
  const denominator = available.reduce((sum, [, weight]) => sum + weight, 0);
  const availableKeys = new Set(available.map(([key]) => key));
  return Object.fromEntries(pairs.map(([key, weight]) => [key, availableKeys.has(key) && denominator > 0 ? weight / denominator : null])) as Record<keyof typeof SCORE_WEIGHTS, number | null>;
}

/** Weighted average over observed components only; missing data never silently becomes zero. */
export function finalScore(components: { statistical: number | null; referral_ring: number | null; network: number | null; behavior: number | null }): number | null {
  const weights = effectiveComponentWeights(components);
  const available = (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[])
    .filter((key) => weights[key] !== null && components[key] !== null && Number.isFinite(components[key]));
  if (!available.length) return null;
  const value = available.reduce((sum, key) => sum + Number(components[key]) * Number(weights[key]), 0);
  return round(clamp(value));
}

export function level(score: number | null): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT DATA" {
  if (score === null || !Number.isFinite(score)) return "INSUFFICIENT DATA";
  if (score >= RISK_THRESHOLDS.critical) return "CRITICAL";
  if (score >= RISK_THRESHOLDS.high) return "HIGH";
  if (score >= RISK_THRESHOLDS.medium) return "MEDIUM";
  return "LOW";
}

export function networkExplanations(signal: any): string[] {
  const result: string[] = [];
  if (signal?.ring_detected) result.push(`Member of cyclic SCC #${signal.scc_id} (${signal.scc_size} providers); inspect the recorded internal referral edges. SCC membership alone does not establish wrongdoing.`);
  if (Number(signal?.incident_referral_events || 0) > 0) result.push(`Referral network signal: ${signal.in_degree} unique incoming source providers and ${signal.out_degree} unique outgoing destination providers, representing ${signal.weighted_in_degree} incoming and ${signal.weighted_out_degree} outgoing referral events.`);
  return result;
}

export function reasons(stats: any, signal: any, component: any, components: any): string[] {
  const result: string[] = [];
  if (!stats || stats.claim_count === 0) result.push("No claims are available for this provider; claim-based indicators are not evaluable.");
  else if (stats.statistical_status === "NO_CURRENT_SPECIALTY_CLAIMS") result.push(`No stored claims match the provider's current specialty (${stats.specialty || "Unspecified"}). Historical claim specialties are preserved; amount and frequency peer comparisons are not evaluated for mismatched specialties.`);
  else if (stats.statistical_status === "INSUFFICIENT_PEERS") result.push(`Amount anomaly comparison is unavailable: only ${stats.peer_provider_count} claim-bearing same-specialty peer provider(s) were available; at least 3 are required.`);
  else if (stats.statistical_status === "ZERO_MEDIAN_BASELINE") result.push("The median same-specialty peer amount baseline is zero, so a peer ratio cannot be interpreted reliably; the billing-amount score is withheld rather than assuming zero risk or inventing a maximum.");
  else if (stats.statistical_status === "EVALUATED") {
    const amountRatio = stats.average_claim_amount_ratio;
    result.push(`Mean billed amount for claims tagged to the current specialty is ₹${Number(stats.average_claim_amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}; the median of same-specialty peer-provider means is ₹${Number(stats.peer_median_average_claim_amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })} across ${stats.peer_provider_count} distinct peer provider(s). Amount ratio: ${Number(amountRatio).toFixed(2)}×. Billing-amount risk is 0 at or below 1×; above 1× it is 100 × log₂(ratio) / 4, bounded to 0–100 and rounded to two decimals.`);
    result.push(`Total billed exposure for matching-specialty claims is ₹${Number(stats.specialty_total_billed_amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })} versus a same-specialty peer median of ₹${Number(stats.peer_median_specialty_total_billed_amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })} (${stats.specialty_total_billed_ratio === null ? "ratio unavailable" : `${Number(stats.specialty_total_billed_ratio).toFixed(2)}×`}). This is contextual evidence, not a second billing-score input. Overall total billed may include historical claims from other specialties; amount risk and normalized matching-specialty claim frequency are scored separately.`);
  }
  // The signed Z-score is a diagnostic independent of whether the median-ratio score is evaluable.
  if (stats?.specialty_z_score !== null && stats?.specialty_z_score !== undefined && Number.isFinite(stats.specialty_z_score)) {
    result.push(`Signed diagnostic Z-score: ${Number(stats.specialty_z_score).toFixed(2)}. This diagnostic is displayed for context and does not directly determine the billing-amount score.`);
  } else if (stats?.statistical_status === "EVALUATED" || stats?.statistical_status === "ZERO_MEDIAN_BASELINE") {
    result.push("Signed diagnostic Z-score is unavailable because the peer-provider means have zero sample standard deviation.");
  }
  if (stats?.peer_activity_ratio !== null && stats?.peer_activity_ratio !== undefined) result.push(`Full-window normalized claim-frequency ratio is ${Number(stats.peer_activity_ratio).toFixed(2)}× the median among distinct same-specialty peers over the dataset's ${stats.observation_days}-day observation window. This is context only; it is not directly scored by the time-aware behavior component.`);
  const behavior = behaviorBreakdown(stats);
  if (stats?.claim_count > 0) {
    for (const signalDetail of behavior.signals) {
      if (signalDetail.score !== null) {
        const weight = signalDetail.effective_weight === null ? "not weighted" : `${(signalDetail.effective_weight * 100).toFixed(1)}% of the behavior component`;
        result.push(`${signalDetail.label}: ratio ${Number(signalDetail.ratio).toFixed(2)}×, sub-score ${Number(signalDetail.score).toFixed(2)} / 100 (${weight}).`);
      } else {
        result.push(`${signalDetail.label}: not evaluable — ${signalDetail.unavailable_reason}.`);
      }
    }
    if (behavior.score === null) result.push(`Behavior component is withheld: only ${behavior.available_signal_count} of 3 time-aware signals are evaluable; at least ${behavior.required_signal_count} are required.`);
    else result.push(`Behavior component score is ${Number(behavior.score).toFixed(2)} from ${behavior.available_signal_count} of 3 time-aware signals. Nominal internal weights are 50% peer recent-30-day activity, 30% own 30-day trend, and 20% short-window burst; they are renormalized over available signals. The reproducible analysis date is ${stats.observation_end || "unavailable"}.`);
  }
  if (signal?.ring_detected && component) result.push(`Cyclic component #${component.scc_id} contains ${component.size} providers and ${component.internal_edges.length} unique internal directed relationships; its displayed cycle path was verified against actual edges.`);
  else if (Number(signal?.incident_referral_events || 0) > 0) result.push("Referral events are present, but no qualifying cyclic SCC of at least three providers was detected; the referral-ring signal is 0. This is not proof that all referral activity is normal.");
  if (signal?.incident_referral_events > 0) result.push(`Weighted network measures use ${signal.incident_referral_events} incoming/outgoing referral-event incidences across ${signal.neighbor_count} distinct neighboring providers; PageRank uses event frequency as edge weight.`);
  const hasEvaluableComponent = Object.values(components || {}).some((value: any) => value !== null && value !== undefined && Number.isFinite(value));
  if (!hasEvaluableComponent) result.push("No evaluable claims or referral-network evidence is available; a risk score is intentionally withheld.");
  return result;
}

export { statisticalRisk, behaviorRisk };
