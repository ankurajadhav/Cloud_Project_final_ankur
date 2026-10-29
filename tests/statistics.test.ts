import test from 'node:test';
import assert from 'node:assert/strict';
import { behaviorBreakdown, behaviorRisk, computeProviderStatistics, mean, median, ratioRisk, sampleStd, statisticalRisk, zScore } from '../src/statistics.ts';
import { calculateAnalytics } from '../src/analytics.ts';
import { finalScore, effectiveComponentWeights, level, RISK_THRESHOLDS, SCORE_WEIGHTS } from '../src/scoring.ts';

const provider = (provider_id: string, specialty = 'Cardiology') => ({ provider_id, provider_name: provider_id, specialty, city: 'Test City', status: 'ACTIVE' });
const claim = (claim_id: string, provider_id: string, amount: number, date = '2026-08-29', specialty = 'Cardiology') => ({ claim_id, provider_id, patient_id: `PAT${claim_id}`, procedure_code: 'PROC-X', claim_amount: amount, claim_date: date, specialty, referred_to: null });

test('mean, median, and sample standard deviation use independently checkable values', () => {
  assert.equal(mean([10, 20, 30]), 20);
  assert.equal(median([40, 10, 30, 20]), 25);
  assert.equal(sampleStd([10, 20, 30]), 10);
  assert.equal(zScore(40, [10, 20, 30]), 2);
});

test('provider Z-score compares provider averages to peer-provider averages, excluding itself', () => {
  const providers = [provider('A'), provider('B'), provider('C'), provider('D')];
  const claims = [claim('A1', 'A', 10), claim('B1', 'B', 20), claim('C1', 'C', 30), claim('D1', 'D', 40)];
  const rows = computeProviderStatistics(claims, providers);
  assert.equal(rows.D.peer_provider_count, 3);
  assert.equal(rows.D.peer_average_claim_amount, 20);
  assert.equal(rows.D.peer_average_claim_stddev, 10);
  assert.equal(rows.D.specialty_z_score, 2);
  assert.equal(rows.D.statistical_status, 'EVALUATED');
  assert.equal(statisticalRisk(rows.D), 25, 'a 2x average-amount ratio maps to 25 on the logarithmic risk curve');
});

test('single-provider specialty and invalid calendar dates are insufficient evidence', () => {
  const rows = computeProviderStatistics([claim('N1', 'N', 90000, '2026-08-29', 'Neurology')], [provider('N', 'Neurology')]);
  assert.equal(rows.N.peer_provider_count, 0);
  assert.equal(rows.N.statistical_status, 'INSUFFICIENT_PEERS');
  assert.equal(rows.N.specialty_z_score, null);
  assert.equal(statisticalRisk(rows.N), null);
  const malformed = computeProviderStatistics([claim('BAD1', 'N', 90000, '2026-02-31', 'Neurology')], [provider('N', 'Neurology')]);
  assert.equal(malformed.N.claim_count, 0, 'invalid calendar date is excluded from calculations');
  assert.equal(malformed.N.observation_end, null);
});

test('a zero peer-median amount baseline is unevaluable, including when provider mean is zero', () => {
  const providers = [provider('A'), provider('B'), provider('C'), provider('D')];
  const claims = [claim('A1', 'A', 0), claim('B1', 'B', 0), claim('C1', 'C', 0), claim('D1', 'D', 100)];
  const rows = computeProviderStatistics(claims, providers);
  assert.equal(rows.A.peer_median_average_claim_amount, 0);
  assert.equal(rows.A.average_claim_amount_ratio, null, '0 / 0 is undefined and must not be silently treated as a 1x ratio');
  assert.equal(rows.A.statistical_status, 'ZERO_MEDIAN_BASELINE');
  assert.equal(statisticalRisk(rows.A), null);
  assert.equal(rows.D.peer_median_average_claim_amount, 0);
  assert.equal(rows.D.average_claim_amount_ratio, null, 'a positive observation over a zero peer median is also unevaluable');
  assert.equal(rows.D.statistical_status, 'ZERO_MEDIAN_BASELINE');
  assert.equal(statisticalRisk(rows.D), null);
});

test('zero-variance peers can still support a robust median-ratio score; Z-score remains unavailable', () => {
  const providers = [provider('A'), provider('B'), provider('C'), provider('D')];
  const claims = [claim('A1', 'A', 100), claim('B1', 'B', 100), claim('C1', 'C', 100), claim('D1', 'D', 200)];
  const rows = computeProviderStatistics(claims, providers);
  assert.equal(rows.D.statistical_status, 'EVALUATED');
  assert.equal(rows.D.specialty_z_score, null);
  assert.equal(rows.D.average_claim_amount_ratio, 2);
  assert.equal(statisticalRisk(rows.D), 25, 'ratio scoring does not depend on a non-zero standard deviation');
});

test('empty claims and provider without claims remain explicitly unevaluable', () => {
  assert.deepEqual(computeProviderStatistics([], []), {});
  const rows = computeProviderStatistics([], [provider('A')]);
  assert.equal(rows.A.claim_count, 0);
  assert.equal(rows.A.statistical_status, 'NO_CLAIMS');
  assert.equal(rows.A.specialty_z_score, null);
  assert.equal(behaviorRisk(rows.A), null);
  const analytics = calculateAnalytics({ providers: [provider('A')], claims: [], referrals: [], dataVersion: 1 });
  assert.equal(analytics.providers[0].risk_score, null);
  assert.equal(analytics.providers[0].risk_level, 'INSUFFICIENT DATA');
});

test('date windows include seven and thirty calendar days and keep prior period separate', () => {
  const providers = [provider('A'), provider('B'), provider('C'), provider('D')];
  const rows = [
    claim('A1', 'A', 100, '2026-08-29'), claim('A2', 'A', 100, '2026-08-23'),
    claim('A3', 'A', 100, '2026-08-22'), claim('A4', 'A', 100, '2026-07-30'),
    claim('B1', 'B', 100, '2026-08-29'), claim('C1', 'C', 100, '2026-08-29'), claim('D1', 'D', 100, '2026-08-29'),
  ];
  const stats = computeProviderStatistics(rows, providers).A;
  assert.equal(stats.observation_end, '2026-08-29');
  assert.equal(stats.claims_7d, 2); // 23rd and 29th; 22nd is outside the 7-day window.
  assert.equal(stats.claims_30d, 3); // 22nd, 23rd and 29th; July 30 is the exclusive lower boundary.
  assert.equal(stats.previous_claims_30d, 1);
  assert.equal(stats.window_7d_complete, true);
  assert.equal(stats.window_30d_complete, true);
  assert.equal(stats.previous_30d_complete, false);
  assert.equal(stats.claims_30d_change_pct, null, 'do not compare a partial prior window as if it were complete');

  const completeSpan = computeProviderStatistics([
    claim('OLD', 'A', 100, '2026-06-30'),
    claim('PREVIOUS', 'A', 100, '2026-07-01'),
    claim('RECENT', 'A', 200, '2026-08-29'),
    claim('B1', 'B', 100, '2026-08-29'), claim('C1', 'C', 100, '2026-08-29'), claim('D1', 'D', 100, '2026-08-29'),
  ], providers).A;
  assert.equal(completeSpan.observation_days, 61);
  assert.equal(completeSpan.previous_30d_complete, true);
  assert.equal(completeSpan.claims_30d_change_pct, 0, 'a fully observed previous window with one claim and current window with one claim has zero change');
});

test('time-aware behavior scoring uses peer 30-day activity, own 30-day trend, and a 7-day burst', () => {
  const providers = [provider('A'), provider('B'), provider('C'), provider('D')];
  const dateRange = (start: string, end: string) => {
    const result: string[] = [];
    for (let day = Date.parse(`${start}T00:00:00Z`); day <= Date.parse(`${end}T00:00:00Z`); day += 86400000) result.push(new Date(day).toISOString().slice(0, 10));
    return result;
  };
  const july = dateRange('2026-07-01', '2026-07-30');
  const prior23 = dateRange('2026-07-31', '2026-08-22');
  const current7 = dateRange('2026-08-23', '2026-08-29');
  const pick = (dates: string[], count: number) => dates.slice(0, count);
  const makeClaims = (prefix: string, id: string, dateList: string[]) => dateList.map((date, index) => claim(`${prefix}${index}`, id, 100, date));
  const claims = [
    ...makeClaims('Aold', 'A', pick(july, 4)),
    ...makeClaims('A23', 'A', pick(prior23, 6)),
    ...makeClaims('A7', 'A', pick(current7, 6)),
    ...makeClaims('Bold', 'B', pick(july, 5)),
    ...makeClaims('B23', 'B', pick(prior23, 4)),
    ...makeClaims('B7', 'B', pick(current7.slice(-1), 1)),
    ...makeClaims('Cold', 'C', pick(july, 5)),
    ...makeClaims('C23', 'C', pick(prior23, 5)),
    ...makeClaims('C7', 'C', pick(current7.slice(-1), 1)),
    ...makeClaims('Dold', 'D', pick(july, 5)),
    ...makeClaims('D23', 'D', pick(prior23, 6)),
    ...makeClaims('D7', 'D', pick(current7.slice(-1), 1)),
  ];
  const stats = computeProviderStatistics(claims, providers);
  assert.equal(stats.A.specialty_claims_30d, 12);
  assert.equal(stats.A.specialty_previous_claims_30d, 4);
  assert.equal(stats.A.peer_median_specialty_claims_30d, 6);
  assert.equal(stats.A.peer_recent_claim_ratio, 2);
  assert.equal(stats.A.own_30d_trend_ratio, 3);
  assert.equal(stats.A.short_window_burst_ratio, 3.2857);
  const detail = behaviorBreakdown(stats.A);
  assert.equal(detail.status, 'EVALUATED');
  assert.equal(detail.available_signal_count, 3);
  assert.equal(detail.signals.find((signal: any) => signal.key === 'peer_30d').score, 66.67);
  assert.equal(detail.signals.find((signal: any) => signal.key === 'own_30d_trend').score, 100);
  assert.equal(detail.signals.find((signal: any) => signal.key === 'short_burst').score, 100);
  const expected = Math.round((66.67 * 0.5 + 100 * 0.3 + 100 * 0.2 + Number.EPSILON) * 100) / 100;
  assert.equal(behaviorRisk(stats.A), expected);

  const singleSignal = behaviorBreakdown({ claim_count: 10, specialty_claim_count: 10, observation_days: 60,
    peer_provider_count: 3, peer_recent_claim_ratio: 2, own_30d_trend_ratio: null, short_window_burst_ratio: null,
    specialty_previous_claims_30d: 0, specialty_claims_prior23d: 0, peer_median_specialty_claims_30d: 5 });
  assert.equal(singleSignal.available_signal_count, 1);
  assert.equal(singleSignal.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(singleSignal.score, null, 'one sub-signal alone must not claim a full behavior score');

  const lowRatio = behaviorBreakdown({ claim_count: 10, specialty_claim_count: 10, observation_days: 60,
    peer_provider_count: 3, peer_recent_claim_ratio: 0.5, own_30d_trend_ratio: 1, short_window_burst_ratio: 0.8,
    specialty_previous_claims_30d: 5, specialty_claims_prior23d: 5, peer_median_specialty_claims_30d: 5 });
  assert.equal(lowRatio.score, 0, 'lower or equal activity does not increase behavior risk');

  const sameDay = computeProviderStatistics([claim('A1', 'A', 10), claim('B1', 'B', 10), claim('C1', 'C', 10), claim('D1', 'D', 10)], providers);
  assert.equal(sameDay.A.peer_recent_claim_ratio, null, 'short datasets cannot claim a complete 30-day comparison');
  assert.equal(behaviorRisk(sameDay.A), null, 'no behavior score without at least two evaluable time-aware signals');
  const twoProviders = computeProviderStatistics([claim('A1', 'A', 10), claim('B1', 'B', 10)], [provider('A'), provider('B')]);
  assert.equal(twoProviders.A.peer_provider_count, 1);
  assert.equal(twoProviders.A.behavior_status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(twoProviders.A.peer_activity_ratio, null);
  assert.equal(behaviorRisk(twoProviders.A), null);
});

test('composite score renormalizes available components and keeps declared bounds', () => {
  assert.equal(finalScore({ statistical: 50, referral_ring: null, network: null, behavior: null }), 50);
  assert.equal(finalScore({ statistical: null, referral_ring: null, network: null, behavior: null }), null);
  assert.equal(finalScore({ statistical: 100, referral_ring: 100, network: 100, behavior: 100 }), 100);
  assert.equal(finalScore({ statistical: -10, referral_ring: null, network: null, behavior: null }), 0);
  assert.equal(level(null), 'INSUFFICIENT DATA');
  assert.equal(level(RISK_THRESHOLDS.critical), 'CRITICAL');
  assert.equal(level(RISK_THRESHOLDS.high), 'HIGH');
  assert.equal(level(RISK_THRESHOLDS.medium), 'MEDIUM');
  assert.equal(level(RISK_THRESHOLDS.medium - 0.01), 'LOW');
  assert.ok(Math.abs(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-12);
});


test('effective score weights match the available components', () => {
  const weights = effectiveComponentWeights({ statistical: 50, referral_ring: null, network: 25, behavior: null });
  assert.ok(Math.abs(Number(weights.statistical) - 2 / 3) < 1e-12);
  assert.equal(weights.referral_ring, null);
  assert.ok(Math.abs(Number(weights.network) - 1 / 3) < 1e-12);
  assert.equal(weights.behavior, null);
  assert.ok(Math.abs(finalScore({ statistical: 50, referral_ring: null, network: 25, behavior: null }) - 41.67) < 1e-8);
});


test('peer comparisons exclude historical claims whose specialty differs from the provider current specialty', () => {
  const providers = [provider('A', 'Cardiology'), provider('B', 'Cardiology'), provider('C', 'Cardiology'), provider('D', 'Cardiology'), provider('E', 'Cardiology')];
  const claims = [
    claim('A-OLD', 'A', 100000, '2026-08-29', 'General Medicine'),
    claim('E-OLD', 'E', 100000, '2026-08-29', 'General Medicine'),
    claim('E-CURRENT', 'E', 150, '2026-08-29', 'Cardiology'),
    claim('B1', 'B', 100, '2026-08-29', 'Cardiology'),
    claim('C1', 'C', 200, '2026-08-29', 'Cardiology'),
    claim('D1', 'D', 300, '2026-08-29', 'Cardiology'),
  ];
  const rows = computeProviderStatistics(claims, providers);
  assert.equal(rows.A.claim_count, 1, 'overall claim count is preserved');
  assert.equal(rows.A.total_billed_amount, 100000, 'overall billed totals include historical claims');
  assert.equal(rows.A.average_claim_amount, null, 'no claim from the current specialty is available for comparison');
  assert.equal(rows.A.overall_average_claim_amount, 100000);
  assert.equal(rows.A.specialty_claim_count, 0);
  assert.equal(rows.A.statistical_status, 'NO_CURRENT_SPECIALTY_CLAIMS');
  assert.equal(rows.A.behavior_status, 'NO_CURRENT_SPECIALTY_CLAIMS');
  assert.equal(rows.A.specialty_z_score, null);
  assert.equal(behaviorRisk(rows.A), null);
  assert.equal(rows.E.claim_count, 2);
  assert.equal(rows.E.specialty_claim_count, 1);
  assert.equal(rows.E.total_billed_amount, 100150);
  assert.equal(rows.E.average_claim_amount, 150, 'peer comparison excludes the 100000 General Medicine historical claim');
  assert.equal(rows.E.overall_average_claim_amount, 50075);
  assert.equal(rows.E.peer_average_claim_amount, 200);
  assert.equal(rows.E.specialty_z_score, -0.5);
});


test('billing amount risk is monotonic and does not double-count total billed exposure', () => {
  assert.equal(ratioRisk(1), 0);
  assert.equal(ratioRisk(2), 25);
  assert.equal(ratioRisk(4), 50);
  assert.ok(ratioRisk(14) > ratioRisk(12));
  const lower = statisticalRisk({ statistical_status: 'EVALUATED', average_claim_amount_ratio: 12, specialty_total_billed_ratio: 12 });
  const higher = statisticalRisk({ statistical_status: 'EVALUATED', average_claim_amount_ratio: 14, specialty_total_billed_ratio: 14 });
  assert.ok(higher > lower);
  assert.equal(statisticalRisk({ statistical_status: 'EVALUATED', average_claim_amount_ratio: 12, specialty_total_billed_ratio: 100 }), lower,
    'total billed ratio is contextual and cannot be counted a second time as an amount signal');
});



test('higher same-specialty claim amounts receive higher or equal final risk when non-billing evidence is held equal', () => {
  const providers = [provider('A'), provider('B'), provider('C'), provider('D')];
  const claims = [claim('A1', 'A', 10), claim('B1', 'B', 20), claim('C1', 'C', 30), claim('D1', 'D', 40)];
  const analytics = calculateAnalytics({ providers, claims, referrals: [], dataVersion: 1 });
  const byId = Object.fromEntries(analytics.providers.map((row: any) => [row.provider_id, row]));
  assert.ok(byId.A.risk_score <= byId.B.risk_score);
  assert.ok(byId.B.risk_score <= byId.C.risk_score);
  assert.ok(byId.C.risk_score <= byId.D.risk_score);
  assert.ok(byId.D.statistical_risk > byId.C.statistical_risk);
});
