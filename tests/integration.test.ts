import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve a local port.'));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
async function waitForServer(port: number, child: ChildProcessWithoutNullStreams): Promise<void> {
  const until = Date.now() + 15000;
  let last: unknown;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`Server exited before becoming ready (code ${child.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
      last = new Error(`health status ${response.status}`);
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${String(last)}`);
}
function startApp(port: number, dbPath: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['--experimental-strip-types', path.join(root, 'server.ts')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HFI_DB_PATH: dbPath, HFI_SEED_DATA_DIR: path.join(root, 'data'), NODE_ENV: 'test' },
    stdio: 'pipe',
  });
}
async function stopApp(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);
}
async function request(port: number, url: string, init?: RequestInit): Promise<{ status: number; body: any; response: Response }> {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, init);
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, body, response };
}
function json(method: string, value?: unknown): RequestInit { return { method, headers: { 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) }; }

test('SQLite-backed API workflow validates, recalculates, audits and persists updates across restart', { timeout: 60000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hfi-integration-'));
  const databasePath = path.join(temp, 'hfi-test.sqlite');
  const port = await freePort();
  let child = startApp(port, databasePath);
  let versionBeforeRestart = 0;
  try {
    await waitForServer(port, child);
    const health = await request(port, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.storage, 'sqlite');
    assert.match(health.response.headers.get('cache-control') || '', /no-store/i, 'live API responses must not be served from a browser cache');
    assert.equal(Number(health.response.headers.get('x-hfi-data-version')), health.body.data_version, 'API responses expose the version observed for consistency checks');
    const meta = await request(port, '/api/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.body.schema_version, 3, 'fresh local databases apply all versioned migrations');

    const initial = await request(port, '/api/summary');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.providers_analyzed, 30);
    assert.equal(initial.body.claims_processed, 1200);
    assert.equal(initial.body.referral_events, 80);
    assert.equal(initial.body.referral_edges, 66, 'referral_edges counts unique directed graph edges, not events');
    assert.equal(initial.body.unique_referral_relationships, 66);
    assert.match((await request(port, '/api/summary')).response.headers.get('cache-control') || '', /no-store/i);
    assert.match((await request(port, '/api/fraud/rings')).response.headers.get('cache-control') || '', /no-store/i, 'ring responses must always reflect a live API read');
    const initialBilled = initial.body.total_billed_amount;
    const startVersion = initial.body.data_version;

    const invalidClaim = await request(port, '/api/claims', json('POST', {
      claim_id: 'CINVALID', provider_id: 'P001', patient_id: 'PATTEST', procedure_code: 'PROC-X', claim_amount: -10,
      claim_date: '2026-08-29', specialty: 'Cardiology',
    }));
    assert.equal(invalidClaim.status, 400);
    assert.match(invalidClaim.body.error, /claim_amount/);
    const invalidDate = await request(port, '/api/claims', json('POST', {
      claim_id: 'CINVALIDDATE', provider_id: 'P001', patient_id: 'PATTESTDATE', procedure_code: 'PROC-X', claim_amount: 10,
      claim_date: '2026-02-31', specialty: 'Cardiology',
    }));
    assert.equal(invalidDate.status, 400);
    assert.match(invalidDate.body.error, /valid calendar date/);
    const missingProvider = await request(port, '/api/claims', json('POST', {
      claim_id: 'CMISSING', provider_id: 'MISSING9', patient_id: 'PATTEST', procedure_code: 'PROC-X', claim_amount: 10,
      claim_date: '2026-08-29', specialty: 'Cardiology',
    }));
    assert.equal(missingProvider.status, 404);

    const createdProvider = await request(port, '/api/providers', json('POST', {
      provider_id: 'TEST9001', provider_name: 'Synthetic Test Provider', specialty: 'Cardiology', city: 'Test City',
    }));
    assert.equal(createdProvider.status, 201);
    assert.equal(createdProvider.body.risk_score, null, 'no-claims/no-referral provider is not assigned an unjustified low or high score');
    assert.equal(createdProvider.body.risk_level, 'INSUFFICIENT DATA');
    const graphAfterProviderCreate = await request(port, '/api/graph');
    assert.ok(graphAfterProviderCreate.body.nodes.some((node: any) => node.provider_id === 'TEST9001'), 'new providers appear immediately in the live whole-network graph');
    assert.equal(graphAfterProviderCreate.body.data_version, (await request(port, '/api/summary')).body.data_version);
    const duplicate = await request(port, '/api/providers', json('POST', {
      provider_id: 'TEST9001', provider_name: 'Duplicate', specialty: 'Cardiology', city: 'Test City',
    }));
    assert.equal(duplicate.status, 409);
    const editedProvider = await request(port, '/api/providers/TEST9001', json('PATCH', { provider_name: 'Synthetic Test Provider Updated', city: 'Updated Test City' }));
    assert.equal(editedProvider.status, 200);
    assert.equal(editedProvider.body.provider_name, 'Synthetic Test Provider Updated');
    assert.equal(editedProvider.body.city, 'Updated Test City');

    const createdClaim = await request(port, '/api/claims', json('POST', {
      claim_id: 'CTEST9001', provider_id: 'TEST9001', patient_id: 'PATTEST9001', procedure_code: 'PROC-X', claim_amount: 25000.5,
      claim_date: '2026-08-29', specialty: 'Cardiology', referral_targets: ['P001', 'P002'],
    }));
    assert.equal(createdClaim.status, 201);
    assert.equal(createdClaim.body.claim_id, 'CTEST9001');
    assert.equal(createdClaim.body.created_referrals.length, 2, 'one referral event is created for each selected recipient');
    assert.deepEqual(createdClaim.body.created_referrals.map((r: any) => r.to_provider).sort(), ['P001', 'P002']);
    assert.ok(createdClaim.body.created_referrals.every((r: any) => r.from_provider === 'TEST9001' && r.source_claim_id === 'CTEST9001'));
    assert.equal((await request(port, '/api/referrals?provider_id=TEST9001')).body.filter((r: any) => r.source_claim_id === 'CTEST9001').length, 2);
    assert.equal((await request(port, '/api/summary')).body.referral_edges, 68, 'network summary adds two unique dependencies, not one combined node');
    const graphAfterClaimCreate = await request(port, '/api/graph');
    assert.ok(graphAfterClaimCreate.body.edges.some((edge: any) => edge.from_provider === 'TEST9001' && edge.to_provider === 'P001'));
    assert.ok(graphAfterClaimCreate.body.edges.some((edge: any) => edge.from_provider === 'TEST9001' && edge.to_provider === 'P002'));
    assert.equal(graphAfterClaimCreate.body.data_version, (await request(port, '/api/summary')).body.data_version, 'claim-linked dependencies and summary must come from the same analytical version');

    // A provider and an outgoing-referral claim refresh the graph immediately, but do not
    // fabricate ring membership until a real directed path back to the provider is added.
    const ringsBeforeTemporaryCycle = (await request(port, '/api/analytics')).body.rings;
    assert.ok(!ringsBeforeTemporaryCycle.some((ring: any) => ring.providers.includes('TEST9001')));
    const closingEdge = await request(port, '/api/referrals', json('POST', {
      referral_id: 'RCYCLE9001', from_provider: 'P002', to_provider: 'TEST9001', reason: 'temporary_cycle_validation',
    }));
    assert.equal(closingEdge.status, 201);
    const completedCycleAnalytics = await request(port, '/api/analytics');
    assert.ok(completedCycleAnalytics.body.rings.some((ring: any) => ring.providers.includes('TEST9001')),
      'live SCC/ring output must include a new provider when new referral data closes a real 3+ node cycle');
    const completedCycleSummary = await request(port, '/api/summary');
    const completedCycleGraph = await request(port, '/api/graph');
    assert.equal(completedCycleGraph.body.data_version, completedCycleSummary.body.data_version, 'summary and graph expose the same calculated data version');
    assert.equal(completedCycleAnalytics.body.summary.data_version, completedCycleSummary.body.data_version, 'ring and summary calculations are version-consistent');
    assert.match((await request(port, '/api/graph')).response.headers.get('cache-control') || '', /no-store/i);
    const removeClosingEdge = await request(port, '/api/referrals/RCYCLE9001', { method: 'DELETE' });
    assert.equal(removeClosingEdge.status, 200);
    const afterCycleRemoved = await request(port, '/api/analytics');
    assert.ok(!afterCycleRemoved.body.rings.some((ring: any) => ring.providers.includes('TEST9001')),
      'removing the edge that closed a cycle must remove temporary ring membership from live results');
    assert.equal((await request(port, '/api/summary')).body.rings_detected, ringsBeforeTemporaryCycle.length);

    const repeatedTarget = await request(port, '/api/claims', json('POST', { claim_id: 'CDUPTARGET', provider_id: 'TEST9001', patient_id: 'PATDUPTARGET', procedure_code: 'PROC-X', claim_amount: 1, claim_date: '2026-08-29', specialty: 'Cardiology', referral_targets: ['P001', 'P001'] }));
    assert.equal(repeatedTarget.status, 400, 'duplicate recipients within one claim are rejected');
    const selfTarget = await request(port, '/api/claims', json('POST', { claim_id: 'CSELFTARGET', provider_id: 'TEST9001', patient_id: 'PATSELFTARGET', procedure_code: 'PROC-X', claim_amount: 1, claim_date: '2026-08-29', specialty: 'Cardiology', referral_targets: ['TEST9001'] }));
    assert.equal(selfTarget.status, 400, 'self-referral recipients are rejected in the multi-recipient claim workflow');
    const afterClaim = await request(port, '/api/summary');
    assert.equal(afterClaim.body.claims_processed, 1201);
    assert.ok(afterClaim.body.total_billed_amount > initialBilled);
    assert.ok(afterClaim.body.data_version > startVersion);
    versionBeforeRestart = afterClaim.body.data_version;

    const createdReferral = await request(port, '/api/referrals', json('POST', {
      referral_id: 'RTEST9001', from_provider: 'P001', to_provider: 'TEST9001', reason: 'integration_test', event_date: '2026-08-29',
    }));
    assert.equal(createdReferral.status, 201);
    const duplicatePair = await request(port, '/api/referrals', json('POST', {
      referral_id: 'RTEST9002', from_provider: 'P001', to_provider: 'P002', reason: 'repeated_event',
    }));
    assert.equal(duplicatePair.status, 201, 'same directed provider pair is allowed as a distinct event');
    const editedReferral = await request(port, '/api/referrals/RTEST9001', json('PATCH', { from_provider: 'TEST9001', to_provider: 'P002', reason: 'edited_integration_test' }));
    assert.equal(editedReferral.status, 200);
    assert.equal(editedReferral.body.reason, 'edited_integration_test');
    assert.equal(editedReferral.body.from_provider, 'TEST9001');
    const afterReferral = await request(port, '/api/summary');
    assert.equal(afterReferral.body.referral_events, 84);
    assert.equal(afterReferral.body.referral_edges, 68, 'edge count counts unique provider pairs even when several events exist');
    assert.equal(afterReferral.body.unique_referral_relationships, 68);
    const graph = await request(port, '/api/graph');
    assert.equal(graph.status, 200);
    assert.equal(graph.body.edges.find((edge: any) => edge.from_provider === 'P001' && edge.to_provider === 'P002')?.event_count, 4);
    assert.equal(graph.body.edges.find((edge: any) => edge.from_provider === 'TEST9001' && edge.to_provider === 'P002')?.event_count, 2, 'claim-linked and manually recorded referral events share one unique directed edge');
    assert.equal(graph.body.edges.some((edge: any) => edge.from_provider === 'P001' && edge.to_provider === 'TEST9001'), false, 'editing endpoints removes the old topology edge');
    const edgeKeys = new Set(graph.body.edges.map((edge: any) => `${edge.from_provider}->${edge.to_provider}`));
    const analytics = await request(port, '/api/analytics');
    for (const ring of analytics.body.rings) {
      assert.ok(ring.cycle_path?.length >= 4);
      assert.equal(ring.cycle_path[0], ring.cycle_path[ring.cycle_path.length - 1]);
      for (let i = 0; i < ring.cycle_path.length - 1; i += 1) assert.ok(edgeKeys.has(`${ring.cycle_path[i]}->${ring.cycle_path[i + 1]}`));
    }

    // Editing ordinary claim fields without `referral_targets` preserves linked recipients.
    const claimEditWithoutRecipients = await request(port, '/api/claims/CTEST9001', json('PATCH', { claim_amount: 26000 }));
    assert.equal(claimEditWithoutRecipients.status, 200);
    assert.equal((await request(port, '/api/referrals?provider_id=TEST9001')).body.filter((r: any) => r.source_claim_id === 'CTEST9001').length, 2,
      'omitting referral_targets from an API patch preserves existing claim-linked referral events');

    // Changing the recipient set removes only no-longer-selected linked events, adds
    // new recipients, and leaves a manual event between the same providers untouched.
    const invalidEditTargets = await request(port, '/api/claims/CTEST9001', json('PATCH', { referral_targets: ['P001', 'P001'] }));
    assert.equal(invalidEditTargets.status, 400, 'editing rejects duplicate recipients before mutating the claim or graph');
    const unchangedAfterInvalidEdit = (await request(port, '/api/referrals?provider_id=TEST9001')).body
      .filter((r: any) => r.source_claim_id === 'CTEST9001');
    assert.deepEqual(unchangedAfterInvalidEdit.map((r: any) => r.to_provider).sort(), ['P001', 'P002']);

    const updatedClaim = await request(port, '/api/claims/CTEST9001', json('PATCH', { claim_amount: 30000, referral_targets: ['P001', 'P003'] }));
    assert.equal(updatedClaim.status, 200);
    assert.deepEqual(updatedClaim.body.created_referrals.map((r: any) => r.to_provider), ['P003'], 'editing adds the newly selected recipient');
    assert.equal(updatedClaim.body.removed_referral_ids.length, 1, 'editing removes the deselected linked referral event');
    assert.deepEqual(updatedClaim.body.linked_referrals.map((r: any) => r.to_provider).sort(), ['P001', 'P003']);
    const referralsAfterClaimEdit = await request(port, '/api/referrals?provider_id=TEST9001');
    const linkedAfterClaimEdit = referralsAfterClaimEdit.body.filter((r: any) => r.source_claim_id === 'CTEST9001');
    assert.deepEqual(linkedAfterClaimEdit.map((r: any) => r.to_provider).sort(), ['P001', 'P003']);
    assert.ok(referralsAfterClaimEdit.body.some((r: any) => r.referral_id === 'RTEST9001' && r.to_provider === 'P002' && r.source_claim_id === null),
      'standalone/manual referral events are not modified when claim-linked recipients are edited');
    const afterClaimReferralEdit = await request(port, '/api/summary');
    assert.equal(afterClaimReferralEdit.body.referral_events, 84, 'recipient replacement removes one linked event and adds one');
    assert.equal(afterClaimReferralEdit.body.referral_edges, 69, 'unique edge count changes only when a provider-pair dependency is added or removed');
    const graphAfterClaimEdit = await request(port, '/api/graph');
    assert.equal(graphAfterClaimEdit.body.edges.find((edge: any) => edge.from_provider === 'TEST9001' && edge.to_provider === 'P001')?.event_count, 1);
    assert.equal(graphAfterClaimEdit.body.edges.find((edge: any) => edge.from_provider === 'TEST9001' && edge.to_provider === 'P002')?.event_count, 1,
      'the remaining P002 edge represents the separate manual event only');
    assert.equal(graphAfterClaimEdit.body.edges.find((edge: any) => edge.from_provider === 'TEST9001' && edge.to_provider === 'P003')?.event_count, 1);
    const updateSummary = await request(port, '/api/summary');
    assert.equal(updateSummary.body.total_billed_amount, Math.round((initialBilled + 30000) * 100) / 100);
    const referralEditAudit = await request(port, '/api/audit?entity_type=referral');
    assert.ok(referralEditAudit.body.some((event: any) => event.operation === 'REMOVE_FROM_CLAIM'), 'deselected recipients receive individual audit events');
    assert.ok(referralEditAudit.body.some((event: any) => event.operation === 'CREATE_FROM_CLAIM_EDIT'), 'added recipients receive individual audit events');

    const providerBeforeCase = (await request(port, '/api/providers/TEST9001')).body.risk_score;
    const createdCase = await request(port, '/api/investigations', json('POST', { provider_id: 'TEST9001', title: 'Verify synthetic claim outlier' }));
    assert.equal(createdCase.status, 201);
    assert.equal(createdCase.body.status, 'PENDING REVIEW');
    const note = await request(port, `/api/investigations/${createdCase.body.case_id}/notes`, json('POST', { body: 'Validation <script>alert("x")</script> & controls.', created_by: 'Test analyst' }));
    assert.equal(note.status, 201);
    const printReport = await request(port, '/api/reports/provider/TEST9001/print');
    assert.equal(printReport.status, 200);
    assert.match(String(printReport.body), /Print \/ Save as PDF/);
    assert.match(String(printReport.body), /Nominal \/ effective weight/);
    assert.match(String(printReport.body), /effective/);
    assert.match(String(printReport.body), /&lt;script&gt;alert/);
    assert.doesNotMatch(String(printReport.body), /<script>alert/);
    const claimAudit = await request(port, '/api/audit?entity_type=claim&entity_id=CTEST9001');
    assert.equal(claimAudit.status, 200);
    assert.ok(claimAudit.body.length >= 2);
    const claimTypeAudit = await request(port, '/api/audit?entity_type=claim');
    assert.ok(claimTypeAudit.body.length >= 2);
    assert.ok(claimTypeAudit.body.every((event: any) => event.entity_type === 'claim'), 'entity_type-only audit filtering must be respected');
    const claimIdAudit = await request(port, '/api/audit?entity_id=CTEST9001');
    assert.ok(claimIdAudit.body.length >= 2);
    assert.ok(claimIdAudit.body.every((event: any) => event.entity_id === 'CTEST9001'), 'entity_id-only audit filtering must be respected');
    for (const event of claimAudit.body) {
      const payload = event.after_json || event.before_json || '';
      assert.doesNotMatch(payload, /PATTEST9001/, 'audit log must not duplicate synthetic patient identifiers');
    }
    const noteAudit = await request(port, `/api/audit?entity_type=investigation_note&entity_id=${note.body.note_id}`);
    assert.equal(noteAudit.status, 200);
    assert.equal(noteAudit.body.length, 1);
    assert.match(noteAudit.body[0].after_json, /body_length/);
    assert.doesNotMatch(noteAudit.body[0].after_json, /Validation|<script>/);
    const updatedCase = await request(port, `/api/investigations/${createdCase.body.case_id}`, json('PATCH', { status: 'UNDER INVESTIGATION' }));
    assert.equal(updatedCase.status, 200);
    const afterCase = await request(port, `/api/providers/TEST9001`);
    assert.equal(afterCase.body.risk_score, providerBeforeCase, 'case status must not influence algorithmic score');
    assert.equal((await request(port, '/api/summary')).body.open_investigations, 1);
    const protectedDeleteCase = await request(port, `/api/investigations/${createdCase.body.case_id}`, { method: 'DELETE' });
    assert.equal(protectedDeleteCase.status, 409, 'case with notes is retained');

    const providerDelete = await request(port, '/api/providers/TEST9001', { method: 'DELETE' });
    assert.equal(providerDelete.status, 409, 'provider with investigation cases cannot be deleted');
    assert.equal((await request(port, '/api/claims?q=CTEST9001')).body.length, 1, 'blocked deletion must not partially cascade claims');
    assert.ok((await request(port, '/api/referrals?provider_id=TEST9001')).body.length > 0, 'blocked deletion must preserve referral evidence');
    const inactive = await request(port, '/api/providers/TEST9001', json('PATCH', { status: 'INACTIVE' }));
    assert.equal(inactive.status, 200);
    assert.equal(inactive.body.status, 'INACTIVE');
    const reactivated = await request(port, '/api/providers/TEST9001', json('PATCH', { status: 'ACTIVE' }));
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.status, 'ACTIVE');
    versionBeforeRestart = (await request(port, '/api/summary')).body.data_version;

    const exportCsv = await request(port, '/api/export/providers.csv');
    assert.equal(exportCsv.status, 200);
    assert.match(String(exportCsv.body), /provider_id/); // CSV content includes provider fields, not an HTML page.
    assert.doesNotMatch(String(exportCsv.body), /\"'-(?:\d|\.)/, 'negative numeric Z-scores must stay numeric, not be rewritten for CSV formula protection');
    const audit = await request(port, '/api/audit?limit=10');
    assert.equal(audit.status, 200);
    assert.ok(audit.body.length > 0);

    await stopApp(child);
    const restartPort = await freePort();
    child = startApp(restartPort, databasePath);
    await waitForServer(restartPort, child);
    const persisted = await request(restartPort, '/api/summary');
    assert.equal(persisted.status, 200);
    assert.equal(persisted.body.claims_processed, 1201);
    assert.equal(persisted.body.referral_events, 84);
    assert.equal(persisted.body.data_version, versionBeforeRestart);
    const claims = await request(restartPort, '/api/claims?q=CTEST9001');
    assert.equal(claims.body.length, 1);
    const removedRepeatedEvent = await request(restartPort, '/api/referrals/RTEST9002', { method: 'DELETE' });
    assert.equal(removedRepeatedEvent.status, 200);
    assert.equal((await request(restartPort, '/api/summary')).body.referral_events, 83);
    const removedNewEdge = await request(restartPort, '/api/referrals/RTEST9001', { method: 'DELETE' });
    assert.equal(removedNewEdge.status, 200);
    const afterReferralDelete = await request(restartPort, '/api/summary');
    assert.equal(afterReferralDelete.body.referral_events, 82, 'claim-linked referral events persist as independent history when the claim is deleted');
    assert.equal(afterReferralDelete.body.unique_referral_relationships, 68, 'claim-linked relationships remain in the graph after claim deletion');
    const removedClaim = await request(restartPort, '/api/claims/CTEST9001', { method: 'DELETE' });
    assert.equal(removedClaim.status, 200);
    assert.equal((await request(restartPort, '/api/summary')).body.claims_processed, 1200);
    const retainedLinkedEvents = await request(restartPort, '/api/referrals?provider_id=TEST9001');
    assert.equal(retainedLinkedEvents.body.filter((r: any) => r.reason === 'claim_linked_referral').length, 2);
    assert.ok(retainedLinkedEvents.body.filter((r: any) => r.reason === 'claim_linked_referral').every((r: any) => r.source_claim_id === null), 'deleting the claim preserves referral history and clears only the source link');
    const persistedProvider = await request(restartPort, '/api/providers/TEST9001');
    assert.equal(persistedProvider.status, 200);
    assert.equal(persistedProvider.body.status, 'ACTIVE');
    assert.equal(persistedProvider.body.claim_count, 0);
    const temporaryProvider = await request(restartPort, '/api/providers', json('POST', { provider_id: 'TEST9002', provider_name: 'Disposable Synthetic Provider', specialty: 'Other', city: 'Test City' }));
    assert.equal(temporaryProvider.status, 201);
    const ownedCascadeClaim = await request(restartPort, '/api/claims', json('POST', {
      claim_id: 'CDEL9002A', provider_id: 'TEST9002', patient_id: 'PATDEL9002A', procedure_code: 'PROC-DEL', claim_amount: 1200,
      claim_date: '2026-08-29', specialty: 'Other', referral_targets: ['P001', 'P002'],
    }));
    assert.equal(ownedCascadeClaim.status, 201);
    assert.equal(ownedCascadeClaim.body.created_referrals.length, 2);
    const referredToCascadeClaim = await request(restartPort, '/api/claims', json('POST', {
      claim_id: 'CDEL9002B', provider_id: 'P001', patient_id: 'PATDEL9002B', procedure_code: 'PROC-DEL', claim_amount: 900,
      claim_date: '2026-08-29', specialty: 'Cardiology', referred_to: 'TEST9002',
    }));
    assert.equal(referredToCascadeClaim.status, 201);
    const endpointCascadeReferral = await request(restartPort, '/api/referrals', json('POST', {
      referral_id: 'RDEL9002', from_provider: 'P001', to_provider: 'TEST9002', reason: 'provider_cascade_test',
    }));
    assert.equal(endpointCascadeReferral.status, 201);

    const safeDelete = await request(restartPort, '/api/providers/TEST9002', { method: 'DELETE' });
    assert.equal(safeDelete.status, 200, 'provider without investigation cases can be deleted with associated operational data');
    assert.equal(safeDelete.body.deleted_claims, 2, 'claims billed by or explicitly referred to the deleted provider are removed');
    assert.equal(safeDelete.body.deleted_referrals, 3, 'endpoint referrals and referrals linked to deleted claims are removed exactly once');
    assert.equal((await request(restartPort, '/api/providers/TEST9002')).status, 404);
    assert.equal((await request(restartPort, '/api/claims?q=CDEL9002A')).body.length, 0);
    assert.equal((await request(restartPort, '/api/claims?q=CDEL9002B')).body.length, 0);
    assert.equal((await request(restartPort, '/api/referrals?provider_id=TEST9002')).body.length, 0);
    assert.equal((await request(restartPort, '/api/summary')).body.providers_analyzed, 31);
    assert.equal((await request(restartPort, '/api/summary')).body.claims_processed, 1200, 'cascade deletion removes both associated claims');
    assert.equal((await request(restartPort, '/api/summary')).body.referral_events, 82, 'cascade deletion removes all three dependent referral events');
    const cascadeClaimAudit = await request(restartPort, '/api/audit?entity_type=claim&entity_id=CDEL9002A');
    assert.ok(cascadeClaimAudit.body.some((event: any) => event.operation === 'DELETE_CASCADE'));
    assert.doesNotMatch(JSON.stringify(cascadeClaimAudit.body), /PATDEL9002A/, 'cascade audit redacts patient identifiers');
    const cascadeReferralAudit = await request(restartPort, '/api/audit?entity_type=referral&entity_id=RDEL9002');
    assert.ok(cascadeReferralAudit.body.some((event: any) => event.operation === 'DELETE_CASCADE'));
    const providerDeleteAudit = await request(restartPort, '/api/audit?entity_type=provider&entity_id=TEST9002');
    assert.ok(providerDeleteAudit.body.some((event: any) => event.operation === 'DELETE' && /deleted_claims/.test(event.after_json || '')));
  } finally {
    await stopApp(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
