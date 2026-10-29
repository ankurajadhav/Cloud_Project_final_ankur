import { computeProviderStatistics, statisticalRisk, behaviorRisk, behaviorBreakdown } from "./statistics.ts";
import { buildGraph, buildEdgeWeights, graphSignals } from "./graph_engine.ts";
import { MODEL_VERSION, SCORE_WEIGHTS, effectiveComponentWeights, ringRisk, networkRisk, finalScore, level, reasons } from "./scoring.ts";

function round(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function calculateAnalytics(input: { providers: any[]; claims: any[]; referrals: any[]; cases?: any[]; dataVersion?: number }) {
  const { providers, claims, referrals } = input;
  const stats = computeProviderStatistics(claims, providers);
  const graph = buildGraph(providers, referrals);
  const weights = buildEdgeWeights(referrals);
  const graphResult = graphSignals(graph, weights, referrals);
  const componentById = new Map(graphResult.sccs.map((component: any) => [component.scc_id, component]));
  const maxPageRank = Math.max(0, ...Object.values(graphResult.signals).map((signal: any) => signal.pagerank));
  const maxIncidentEvents = Math.max(0, ...Object.values(graphResult.signals).map((signal: any) => signal.incident_referral_events));
  const rows = providers.map((provider) => {
    const providerId = provider.provider_id;
    const s = stats[providerId];
    const g = graphResult.signals[providerId];
    const component = componentById.get(g?.scc_id) as any;
    const componentScores = {
      statistical: statisticalRisk(s),
      referral_ring: ringRisk(g, component),
      network: networkRisk(g, maxPageRank, maxIncidentEvents),
      behavior: behaviorRisk(s),
    };
    const score = finalScore(componentScores);
    return {
      ...provider,
      ...s,
      statistical_risk: componentScores.statistical,
      referral_ring_risk: componentScores.referral_ring,
      network_risk: componentScores.network,
      behaviour_risk: componentScores.behavior,
      behavior_breakdown: behaviorBreakdown(s),
      component_scores: componentScores,
      nominal_component_weights: SCORE_WEIGHTS,
      effective_component_weights: effectiveComponentWeights(componentScores),
      risk_score: score,
      risk_level: level(score),
      scc_id: g?.scc_id ?? null,
      scc_size: g?.scc_size ?? 1,
      cyclic_component: Boolean(g?.cyclic_component),
      ring_detected: Boolean(g?.ring_detected),
      pagerank: g?.pagerank ?? 0,
      in_degree: g?.in_degree ?? 0,
      out_degree: g?.out_degree ?? 0,
      weighted_in_degree: g?.weighted_in_degree ?? 0,
      weighted_out_degree: g?.weighted_out_degree ?? 0,
      incident_referral_events: g?.incident_referral_events ?? 0,
      neighbor_count: g?.neighbor_count ?? 0,
      explanation: reasons(s, g, component, componentScores),
      score_methodology: "Heuristic, evidence-weighted score; not a calibrated probability of fraud.",
    };
  });
  rows.sort((a, b) => (b.risk_score ?? -1) - (a.risk_score ?? -1) || a.provider_id.localeCompare(b.provider_id));

  const rings = graphResult.sccs.filter((component: any) => component.ring_detected)
    .map((component: any) => ({ ...component }));
  const billedTotal = claims.reduce((sum, claim) => sum + Number(claim.claim_amount || 0), 0);
  const riskCounts = rows.reduce((counts: Record<string, number>, row) => {
    counts[row.risk_level] = (counts[row.risk_level] || 0) + 1;
    return counts;
  }, {});
  const specialtyTotals: Record<string, { specialty: string; claims: number; billed_amount: number; providers: number }> = {};
  for (const provider of providers) {
    const specialty = String(provider.specialty || "Unspecified");
    specialtyTotals[specialty] ||= { specialty, claims: 0, billed_amount: 0, providers: 0 };
    specialtyTotals[specialty].providers += 1;
  }
  for (const claim of claims) {
    const specialty = String(claim.specialty || "Unspecified");
    specialtyTotals[specialty] ||= { specialty, claims: 0, billed_amount: 0, providers: 0 };
    specialtyTotals[specialty].claims += 1;
    specialtyTotals[specialty].billed_amount += Number(claim.claim_amount || 0);
  }
  const riskTrendByScore = [
    { category: "Critical", value: riskCounts.CRITICAL || 0 },
    { category: "High", value: riskCounts.HIGH || 0 },
    { category: "Medium", value: riskCounts.MEDIUM || 0 },
    { category: "Low", value: riskCounts.LOW || 0 },
    { category: "Insufficient data", value: riskCounts["INSUFFICIENT DATA"] || 0 },
  ];
  const summary = {
    claims_processed: claims.length,
    providers_analyzed: providers.length,
    active_providers: providers.filter((provider) => provider.status !== "INACTIVE").length,
    total_billed_amount: round(billedTotal),
    referral_events: referrals.length,
    referral_edges: graphResult.uniqueDirectedEdges,
    unique_referral_relationships: graphResult.uniqueDirectedEdges,
    rings_detected: rings.length,
    critical_providers: riskCounts.CRITICAL || 0,
    high_risk_providers: riskCounts.HIGH || 0,
    medium_risk_providers: riskCounts.MEDIUM || 0,
    low_risk_providers: riskCounts.LOW || 0,
    insufficient_data_providers: riskCounts["INSUFFICIENT DATA"] || 0,
    open_investigations: (input.cases || []).filter((item) => ["PENDING REVIEW", "UNDER INVESTIGATION"].includes(String(item.status).toUpperCase())).length,
    calculated_at: new Date().toISOString(),
    model_version: MODEL_VERSION,
    data_version: input.dataVersion ?? 1,
    statistical_method: "Mean billed amount for claims tagged to current provider specialty vs median of distinct same-specialty provider means; >=3 matching-specialty peers; monotonic logarithmic upper-tail amount-ratio score. Z-score is diagnostic only. Total billed exposure is contextual; the behavior component uses time-aware 30-day peer activity, own prior-30-day trend, and 7-day burst comparisons.",
    risk_model: "Weighted heuristic score: 40% billing-amount anomaly, 30% qualifying referral-ring signal, 20% referral-network signal, 10% time-aware behavior. Behavior combines recent 30-day specialty claim volume vs peers (50%), current vs prior 30-day specialty activity (30%), and 7-day vs preceding 23-day claim-rate burst (20%); at least two available behavior signals are required and internal weights are renormalized. Unavailable top-level component weights are also renormalized. Not a calibrated fraud probability.",
  };
  return {
    summary,
    providers: rows,
    rings,
    graph: {
      data_version: summary.data_version,
      model_version: MODEL_VERSION,
      calculated_at: summary.calculated_at,
      nodes: providers.map((provider) => ({ ...provider, ...(graphResult.signals[provider.provider_id] || {}) })),
      edges: Object.entries(graph).flatMap(([from, targets]) => targets.map((to) => ({ from_provider: from, to_provider: to, event_count: weights[from]?.[to] ?? 1 }))),
    },
    specialty_summary: Object.values(specialtyTotals).map((row) => ({ ...row, billed_amount: round(row.billed_amount) })).sort((a, b) => a.specialty.localeCompare(b.specialty)),
    risk_distribution: riskTrendByScore,
  };
}

export function summarizeSnapshot(snapshot: any) {
  const summary = JSON.parse(snapshot.summary_json);
  return { snapshot_id: snapshot.snapshot_id, data_version: snapshot.data_version, model_version: snapshot.model_version, calculated_at: snapshot.calculated_at, summary };
}
