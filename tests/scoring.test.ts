import test from 'node:test';
import assert from 'node:assert/strict';
import { ringRisk, networkRisk, reasons, finalScore, MODEL_VERSION } from '../src/scoring.ts';

test('non-ring providers with observed referral events receive a zero ring signal, not a missing component', () => {
  assert.equal(ringRisk({ ring_detected: false, incident_referral_events: 2 }, { ring_detected: false, size: 2, internal_edges: [] }), 0);
  assert.equal(ringRisk({ ring_detected: false, incident_referral_events: 0 }, { ring_detected: false, size: 1, internal_edges: [] }), null);
});

test('ring density and repeated-event bonus exclude self-loops and cap at the true maximum 75', () => {
  const signal = { ring_detected: true, incident_referral_events: 10 };
  const componentWithLoop = {
    ring_detected: true,
    size: 3,
    internal_edges: [
      { from_provider: 'A', to_provider: 'B', event_count: 2 },
      { from_provider: 'B', to_provider: 'C', event_count: 1 },
      { from_provider: 'C', to_provider: 'A', event_count: 1 },
      { from_provider: 'A', to_provider: 'A', event_count: 100 },
    ],
    repeated_event_count: 100,
  };
  assert.equal(ringRisk(signal, componentWithLoop), 52, 'self-loop events cannot inflate a three-edge cycle score');

  const completeEdges = [];
  for (const from of ['A', 'B', 'C']) for (const to of ['A', 'B', 'C']) {
    completeEdges.push({ from_provider: from, to_provider: to, event_count: from === to ? 100 : 3 });
  }
  assert.equal(ringRisk(signal, { ring_detected: true, size: 3, internal_edges: completeEdges }), 75);
});

test('zero-valued component scores do not trigger a false no-evidence explanation', () => {
  const explanation = reasons({ claim_count: 1, statistical_status: 'EVALUATED', specialty_z_score: -1, average_claim_amount: 10, peer_average_claim_amount: 20, peer_provider_count: 3 },
    { ring_detected: false, incident_referral_events: 1, in_degree: 1, out_degree: 0, weighted_in_degree: 1, weighted_out_degree: 0, neighbor_count: 1 },
    { scc_id: 1, size: 1, internal_edges: [] },
    { statistical: 0, referral_ring: 0, network: 0, behavior: 0 });
  assert.ok(explanation.some((line) => line.includes('referral-ring signal is 0')));
  assert.ok(explanation.some((line) => line.includes('Signed diagnostic Z-score: -1.00')), 'diagnostic Z-scores are signed and do not directly drive the score');
  assert.ok(!explanation.some((line) => line.includes('No evaluable claims or referral-network evidence')));
});


test('signed diagnostic Z-score is shown even when a zero peer-median amount baseline withholds billing risk', () => {
  const withDiagnostic = reasons(
    { claim_count: 4, statistical_status: 'ZERO_MEDIAN_BASELINE', specialty_z_score: 1.25, peer_provider_count: 3 },
    { ring_detected: false, incident_referral_events: 0 },
    null,
    { statistical: null, referral_ring: null, network: null, behavior: null },
  );
  assert.ok(withDiagnostic.some((line) => line.includes('billing-amount score is withheld')));
  assert.ok(withDiagnostic.some((line) => line.includes('Signed diagnostic Z-score: 1.25')));

  const withoutDiagnostic = reasons(
    { claim_count: 4, statistical_status: 'EVALUATED', specialty_z_score: null, peer_provider_count: 3 },
    { ring_detected: false, incident_referral_events: 0 },
    null,
    { statistical: 20, referral_ring: null, network: null, behavior: null },
  );
  assert.ok(withoutDiagnostic.some((line) => line.includes('zero sample standard deviation')));
});


test('network component uses the documented 60/40 normalized centrality/activity formula', () => {
  assert.equal(networkRisk({ pagerank: 0.5, incident_referral_events: 4 }, 1, 8), 50);
  assert.equal(networkRisk({ pagerank: 0.2, incident_referral_events: 2 }, 1, 8), 22);
  assert.equal(networkRisk({ pagerank: 0.5, incident_referral_events: 0 }, 1, 8), null);
});

test('model version is incremented for the zero-baseline scoring correction', () => {
  assert.equal(MODEL_VERSION, 'hfi-2.3.3');
  assert.equal(finalScore({ statistical: 50, referral_ring: 60, network: 40, behavior: 20 }), 48);
});
