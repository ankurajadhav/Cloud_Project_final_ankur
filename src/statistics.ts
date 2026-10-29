/** Statistical features for a deterministic, provider-level comparison pipeline. */
export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample standard deviation; a zero-variance reference is not treated as normal evidence. */
export function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}

export function zScore(value: number, referenceValues: number[]): number | null {
  if (!Number.isFinite(value) || referenceValues.length < 2) return null;
  const sd = sampleStd(referenceValues);
  if (sd === 0) return null;
  return (value - mean(referenceValues)) / sd;
}

function validAmount(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}
function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}
function daysBetween(start: string, end: string): number {
  return Math.max(1, Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1);
}
function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}
function round(value: number, places = 2): number {
  const p = 10 ** places;
  return Math.round((value + Number.EPSILON) * p) / p;
}
/**
 * A peer-relative upper-tail ratio. Any zero peer baseline is unevaluable: 0/0 is
 * undefined, while a positive observation over zero must not be turned into an
 * infinite or fabricated maximum score.
 */
function safePeerRatio(observed: number | null, baseline: number | null): number | null {
  if (observed === null || baseline === null || !Number.isFinite(observed) || !Number.isFinite(baseline) || observed < 0 || baseline < 0) return null;
  if (baseline === 0) return null;
  return round(observed / baseline, 6);
}

/**
 * Monotonic logarithmic risk curve for upper-tail peer ratios:
 * 1x => 0, 2x => 25, 4x => 50, 8x => 75, 16x or above => 100.
 */
export function ratioRisk(ratio: number | null): number | null {
  if (ratio === null || !Number.isFinite(ratio) || ratio < 0) return null;
  if (ratio <= 1) return 0;
  return round(clamp(100 * Math.log2(ratio) / 4));
}

/**
 * Compares provider-level averages of claims tagged to the provider's current specialty
 * against distinct same-specialty provider summaries, excluding the provider assessed.
 * At least three distinct peer providers are required. The historical specialty on a claim
 * is preserved but does not silently redefine the provider's peer group.
 */
export function computeProviderStatistics(claims: any[], providers: any[]): Record<string, any> {
  const byProvider = new Map<string, any[]>();
  const cleanedClaims = claims.map((claim) => {
    const amount = validAmount(claim.claim_amount);
    const date = validDate(claim.claim_date);
    return amount === null || date === null ? null : { ...claim, _amount: amount, _date: date };
  }).filter(Boolean) as any[];

  for (const claim of cleanedClaims) {
    if (!byProvider.has(claim.provider_id)) byProvider.set(claim.provider_id, []);
    byProvider.get(claim.provider_id)!.push(claim);
  }

  const allDates = cleanedClaims.map((claim) => claim._date).sort();
  const asOfDate: string | null = allDates.length ? allDates[allDates.length - 1] : null;
  const observationStart: string | null = allDates.length ? allDates[0] : null;
  const observationDays = asOfDate && observationStart ? daysBetween(observationStart, asOfDate) : 0;
  const base: Record<string, any> = {};

  for (const provider of providers) {
    const providerClaims = byProvider.get(provider.provider_id) || [];
    const currentSpecialty = String(provider.specialty || "").trim().toLocaleLowerCase();
    // The claim's stored specialty is historical evidence. Do not silently
    // relabel old claims when a provider's current specialty changes, and do
    // not mix unlike specialties in current-specialty peer comparisons.
    const comparableClaims = providerClaims.filter((claim) => String(claim.specialty || "").trim().toLocaleLowerCase() === currentSpecialty);
    const allAmounts: number[] = providerClaims.map((claim) => claim._amount);
    const amounts: number[] = comparableClaims.map((claim) => claim._amount);
    const total = allAmounts.reduce((sum, amount) => sum + amount, 0);
    const specialtyTotal = amounts.reduce((sum, amount) => sum + amount, 0);
    const average = amounts.length ? specialtyTotal / amounts.length : null;
    const overallAverage = allAmounts.length ? total / allAmounts.length : null;
    const sortedDates = providerClaims.map((claim) => claim._date).sort();
    // Window boundaries are reproducible against the latest valid claim date in this
    // dataset: lower bound exclusive, upper bound inclusive. Supplying a source array
    // makes all-specialty dashboard counts distinct from matching-specialty risk signals.
    const countIn = (source: any[], days: number, end: string | null, startOffset = 0) => {
      if (!end) return [] as any[];
      const endMs = Date.parse(`${end}T00:00:00Z`) - startOffset * 86_400_000;
      const startMs = endMs - days * 86_400_000;
      return source.filter((claim) => {
        const ms = Date.parse(`${claim._date}T00:00:00Z`);
        return ms > startMs && ms <= endMs;
      });
    };
    // The burst comparison uses disjoint 7-day and preceding 23-day intervals.
    const countBetweenOffsets = (source: any[], lowerOffset: number, upperOffset: number, end: string | null) => {
      if (!end) return [] as any[];
      const endMs = Date.parse(`${end}T00:00:00Z`);
      const lowerMs = endMs - upperOffset * 86_400_000;
      const upperMs = endMs - lowerOffset * 86_400_000;
      return source.filter((claim) => {
        const ms = Date.parse(`${claim._date}T00:00:00Z`);
        return ms > lowerMs && ms <= upperMs;
      });
    };
    const current7 = countIn(providerClaims, 7, asOfDate);
    const current30 = countIn(providerClaims, 30, asOfDate);
    const previous30 = countIn(providerClaims, 30, asOfDate, 30);
    const specialtyCurrent7 = countIn(comparableClaims, 7, asOfDate);
    const specialtyCurrent30 = countIn(comparableClaims, 30, asOfDate);
    const specialtyPrevious30 = countIn(comparableClaims, 30, asOfDate, 30);
    const specialtyPrior23 = countBetweenOffsets(comparableClaims, 7, 30, asOfDate);
    const per30 = observationDays ? comparableClaims.length / observationDays * 30 : null;
    base[provider.provider_id] = {
      claim_count: providerClaims.length,
      specialty_claim_count: comparableClaims.length,
      total_billed_amount: round(total),
      specialty_total_billed_amount: round(specialtyTotal),
      average_claim_amount: average === null ? null : round(average),
      overall_average_claim_amount: overallAverage === null ? null : round(overallAverage),
      active_claim_dates: new Set(sortedDates).size,
      claims_7d: current7.length,
      billed_7d: round(current7.reduce((sum, claim) => sum + claim._amount, 0)),
      claims_30d: current30.length,
      billed_30d: round(current30.reduce((sum, claim) => sum + claim._amount, 0)),
      previous_claims_30d: previous30.length,
      previous_billed_30d: round(previous30.reduce((sum, claim) => sum + claim._amount, 0)),
      claims_30d_change_pct: observationDays >= 60 && previous30.length ? round((current30.length - previous30.length) / previous30.length * 100) : null,
      billed_30d_change_pct: observationDays >= 60 && previous30.reduce((sum, claim) => sum + claim._amount, 0) > 0
        ? round((current30.reduce((sum, claim) => sum + claim._amount, 0) - previous30.reduce((sum, claim) => sum + claim._amount, 0)) / previous30.reduce((sum, claim) => sum + claim._amount, 0) * 100)
        : null,
      claims_per_30d: per30 === null ? null : round(per30, 4),
      // Matching-specialty time windows are separate from all-specialty descriptive counts.
      specialty_claims_7d: specialtyCurrent7.length,
      specialty_claims_30d: specialtyCurrent30.length,
      specialty_previous_claims_30d: specialtyPrevious30.length,
      specialty_claims_prior23d: specialtyPrior23.length,
      observation_days: observationDays,
      observation_start: observationStart,
      observation_end: asOfDate,
      window_7d_complete: observationDays >= 7,
      window_30d_complete: observationDays >= 30,
      previous_30d_complete: observationDays >= 60,
      specialties: [...new Set(providerClaims.map((claim) => claim.specialty).filter(Boolean))],
    };
  }

  // Build the peer distribution from one average per provider, never individual claims.
  const providersBySpecialty = new Map<string, any[]>();
  for (const provider of providers) {
    const specialty = String(provider.specialty || "").trim();
    if (!providersBySpecialty.has(specialty)) providersBySpecialty.set(specialty, []);
    providersBySpecialty.get(specialty)!.push(provider);
  }

  for (const provider of providers) {
    const row = base[provider.provider_id];
    const specialtyPeers = (providersBySpecialty.get(String(provider.specialty || "").trim()) || [])
      .filter((peer) => peer.provider_id !== provider.provider_id && base[peer.provider_id]?.specialty_claim_count > 0);
    const peerAverages = specialtyPeers.map((peer) => base[peer.provider_id].average_claim_amount as number);
    const peerSpecialtyTotals = specialtyPeers.map((peer) => base[peer.provider_id].specialty_total_billed_amount as number);
    const peerActivity = specialtyPeers.map((peer) => base[peer.provider_id].claims_per_30d as number);
    const peerRecentClaims = specialtyPeers.map((peer) => base[peer.provider_id].specialty_claims_30d as number);
    const peerMedianAverage = peerAverages.length ? median(peerAverages) : null;
    const peerMedianTotal = peerSpecialtyTotals.length ? median(peerSpecialtyTotals) : null;
    const peerMedianActivity = peerActivity.length ? median(peerActivity) : null;
    const peerMedianRecentClaims = peerRecentClaims.length ? median(peerRecentClaims) : null;
    row.peer_provider_count = specialtyPeers.length;
    row.peer_average_claim_amount = peerAverages.length ? round(mean(peerAverages)) : null;
    row.peer_median_average_claim_amount = peerMedianAverage === null ? null : round(peerMedianAverage);
    row.peer_average_claim_stddev = peerAverages.length >= 2 ? round(sampleStd(peerAverages)) : null;
    row.peer_median_specialty_total_billed_amount = peerMedianTotal === null ? null : round(peerMedianTotal);
    row.peer_median_claims_per_30d = peerMedianActivity === null ? null : round(peerMedianActivity, 4);
    row.average_claim_amount_ratio = specialtyPeers.length >= 3 ? safePeerRatio(row.average_claim_amount, peerMedianAverage) : null;
    row.specialty_total_billed_ratio = specialtyPeers.length >= 3 ? safePeerRatio(row.specialty_total_billed_amount, peerMedianTotal) : null;
    // Kept as a descriptive full-window ratio for investigation context only.
    row.peer_activity_ratio = specialtyPeers.length >= 3 && peerMedianActivity !== null && peerMedianActivity > 0 && row.claims_per_30d !== null
      ? round(row.claims_per_30d / peerMedianActivity, 4)
      : null;
    row.peer_median_specialty_claims_30d = peerMedianRecentClaims === null ? null : round(peerMedianRecentClaims, 4);
    // Three time-aware behavior signals. Null means the comparison lacks a valid
    // denominator, enough peers, or a sufficiently long observation span.
    row.peer_recent_claim_ratio = row.specialty_claim_count > 0 && observationDays >= 30 && specialtyPeers.length >= 3 && peerMedianRecentClaims !== null && peerMedianRecentClaims >= 3
      ? round(row.specialty_claims_30d / peerMedianRecentClaims, 4)
      : null;
    row.own_30d_trend_ratio = observationDays >= 60 && row.specialty_previous_claims_30d >= 3
      ? round(row.specialty_claims_30d / row.specialty_previous_claims_30d, 4)
      : null;
    row.short_window_burst_ratio = observationDays >= 30 && row.specialty_claims_prior23d >= 3
      ? round((row.specialty_claims_7d / 7) / (row.specialty_claims_prior23d / 23), 4)
      : null;
    row.statistical_status = row.claim_count === 0
      ? "NO_CLAIMS"
      : row.specialty_claim_count === 0
        ? "NO_CURRENT_SPECIALTY_CLAIMS"
        : specialtyPeers.length < 3
          ? "INSUFFICIENT_PEERS"
          : row.average_claim_amount_ratio !== null
            ? "EVALUATED"
            : "ZERO_MEDIAN_BASELINE";
    // Z-score is retained only as a diagnostic. It no longer drives the billing risk score.
    row.specialty_z_score = specialtyPeers.length >= 3 && row.average_claim_amount !== null && sampleStd(peerAverages) > 0
      ? round(zScore(row.average_claim_amount, peerAverages) as number, 4)
      : null;
    const behaviorDetails = behaviorBreakdown(row);
    row.behavior_status = behaviorDetails.status;
    row.behavior_available_signal_count = behaviorDetails.available_signal_count;
  }

  // The peer baseline is across the same data window and specialty; absolute volume alone is not a risk label.
  return base;
}

/**
 * Billing-amount risk uses one non-duplicated signal: provider mean claim amount relative
 * to the median of distinct same-specialty peer-provider means. Total billed exposure
 * is reported for context, while comparative claim frequency is scored separately by
 * behaviorRisk. This avoids scoring the same signal twice when providers have equal claim
 * counts (total billed = mean amount × claim count). Z-score is diagnostic only.
 */
export function statisticalRisk(stats: any): number | null {
  if (!stats || stats.statistical_status !== "EVALUATED") return null;
  const ratio = stats.average_claim_amount_ratio;
  if (ratio === undefined || ratio === null || !Number.isFinite(ratio)) return null;
  return ratioRisk(ratio);
}

const BEHAVIOR_SIGNAL_WEIGHTS = { peer_30d: 0.50, own_30d_trend: 0.30, short_burst: 0.20 } as const;
const MIN_BEHAVIOR_SIGNALS = 2;

function increaseRisk(ratio: number | null | undefined): number | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio) || ratio < 0) return null;
  // Ratio <= 1x maps to 0; 2.5x or above maps to 100. This is a transparent
  // upper-tail heuristic, not a probability or calibrated fraud score.
  return round(clamp(((ratio - 1) / 1.5) * 100));
}

/**
 * Explainable behavior score made from three time-aware claim-frequency comparisons:
 * 50% recent-30-day activity vs same-specialty peers; 30% current vs prior 30 days;
 * 20% 7-day claim rate vs the preceding 23-day rate. It requires at least two
 * evaluable signals; sub-weights are renormalized only among available signals.
 */
export function behaviorBreakdown(stats: any): any {
  const observationDays = Number(stats?.observation_days || 0);
  const peerCount = Number(stats?.peer_provider_count || 0);
  const prior30 = Number(stats?.specialty_previous_claims_30d || 0);
  const prior23 = Number(stats?.specialty_claims_prior23d || 0);
  const peerMedian30 = stats?.peer_median_specialty_claims_30d;

  const signalDefinitions = [
    {
      key: "peer_30d", label: "Recent 30-day activity vs peers", weight: BEHAVIOR_SIGNAL_WEIGHTS.peer_30d,
      ratio: stats?.peer_recent_claim_ratio,
      unavailableReason: observationDays < 30 ? "requires a dataset span covering a complete 30-day window"
        : peerCount < 3 ? "requires at least three distinct claim-bearing same-specialty peers"
          : peerMedian30 === null || peerMedian30 === undefined || Number(peerMedian30) < 3 ? "the same-specialty peer median is below three claims or is unavailable"
            : "the peer comparison could not be calculated from the available records",
    },
    {
      key: "own_30d_trend", label: "Current 30 days vs prior 30 days", weight: BEHAVIOR_SIGNAL_WEIGHTS.own_30d_trend,
      ratio: stats?.own_30d_trend_ratio,
      unavailableReason: observationDays < 60 ? "requires a dataset span covering two complete non-overlapping 30-day windows"
        : prior30 < 3 ? "the prior 30-day matching-specialty baseline contains fewer than three claims"
          : "the provider's own-period trend could not be calculated",
    },
    {
      key: "short_burst", label: "7-day rate vs preceding 23-day rate", weight: BEHAVIOR_SIGNAL_WEIGHTS.short_burst,
      ratio: stats?.short_window_burst_ratio,
      unavailableReason: observationDays < 30 ? "requires a dataset span covering a complete 30-day window"
        : prior23 < 3 ? "the preceding 23-day matching-specialty baseline contains fewer than three claims"
          : "the short-window rate comparison could not be calculated",
    },
  ];
  const signals = signalDefinitions.map((signal) => {
    const ratio = signal.ratio !== undefined && signal.ratio !== null && Number.isFinite(signal.ratio) ? Number(signal.ratio) : null;
    return {
      key: signal.key,
      label: signal.label,
      nominal_weight: signal.weight,
      ratio,
      score: increaseRisk(ratio),
      available: increaseRisk(ratio) !== null,
      effective_weight: null as number | null,
      unavailable_reason: increaseRisk(ratio) === null ? signal.unavailableReason : null,
    };
  });
  const available = signals.filter((signal) => signal.score !== null);
  const denominator = available.reduce((sum, signal) => sum + signal.nominal_weight, 0);
  const enoughEvidence = available.length >= MIN_BEHAVIOR_SIGNALS;
  if (enoughEvidence && denominator > 0) {
    for (const signal of available) signal.effective_weight = signal.nominal_weight / denominator;
  }
  const score = enoughEvidence && denominator > 0
    ? round(clamp(available.reduce((sum, signal) => sum + Number(signal.score) * signal.nominal_weight, 0) / denominator))
    : null;
  let status = available.length >= 3 ? "EVALUATED" : available.length === 2 ? "PARTIAL_EVIDENCE" : "INSUFFICIENT_EVIDENCE";
  if (!stats || Number(stats.claim_count || 0) === 0) status = "NO_CLAIMS";
  else if (Number(stats.specialty_claim_count || 0) === 0) status = "NO_CURRENT_SPECIALTY_CLAIMS";
  return {
    score,
    status,
    available_signal_count: available.length,
    required_signal_count: MIN_BEHAVIOR_SIGNALS,
    signals,
  };
}

/** Time-aware comparative behavior heuristic; null means fewer than two valid signals. */
export function behaviorRisk(stats: any): number | null {
  return behaviorBreakdown(stats).score;
}
