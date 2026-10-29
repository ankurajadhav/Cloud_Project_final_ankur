# Verification Report — Healthcare Fraud Intelligence 2.3.7

**Release:** 2.3.7  
**Analytics model:** hfi-2.3.0 (unchanged)  
**Primary change:** edit-claim workflow now manages multiple linked referral recipients.

## Implemented behavior

- The Edit Claim form loads the recipients from referral events whose `source_claim_id` equals the edited claim ID.
- Users can select multiple recipients, add recipients, or uncheck existing recipients and save once.
- `PATCH /api/claims/:claimId` reconciles recipients only when the `referral_targets` property is supplied. For backward compatibility, clients that omit that property do not alter referral events.
- The claim and referral changes share the existing SQLite transaction, data-version increment, audit entries, analytical recalculation, and snapshot. If validation or analytics fails, the complete edit is rolled back.
- Newly selected recipients must be active. A previously linked inactive provider may remain selected or be removed, but cannot be added to a new claim-linked relationship.
- Self-referrals, duplicate recipient IDs, unknown provider IDs, non-array values, and more than 100 recipients are rejected by the backend.
- Existing linked referral events follow the claim's new source provider and claim date when those claim fields change.
- Standalone/manual referral events (`source_claim_id IS NULL`) are never changed by editing the claim's recipient set.
- The network continues to display one directed edge per unique provider pair, aggregating the number of referral events as the edge weight.
- Individual referral additions, removals, and updates are audited without copying patient identifiers.

## Checks executed

| Check | Result |
|---|---|
| `npm test` | **32/32 passed**, including SQLite-backed HTTP integration tests |
| `npm run lint` | **Passed** — TypeScript no-emit check |
| `npm run build` | **Passed** — production source build |
| `node --check frontend/app.js` | **Passed** |
| Edit-claim recipient reconciliation | **Passed** — adding P003 and removing P002 produces the expected linked recipient set |
| API patch omitting `referral_targets` | **Passed** — existing claim-linked referral events are preserved |
| Invalid duplicate recipients | **Passed** — HTTP 400; existing claim/referral state remains unchanged |
| Manual-referral preservation | **Passed** — a standalone manual event is untouched by a claim recipient edit |
| Event count vs unique edge count | **Passed** — event totals and unique dependency counts update independently |
| Claim/referral audit records | **Passed** — recipient additions/removals generate per-event audit records |
| Asset/version markers | **Passed** — HTML references `style.css?v=2.3.7` and `app.js?v=2.3.7`; UI profile marker identifies 2.3.7 |

Tests ran on Node.js 22.16.0 with a temporary SQLite database. Dependencies were reused from the supplied environment for this test run; a fresh Windows `npm install` and manual browser click-through were not run here. The release ZIP excludes `node_modules`, generated databases, and the local symlink used for testing.

## Known limitations

- Browser-level visual testing on the user's Windows machine was not performed; use the visible `UI 2.3.7` marker to confirm the current frontend is loaded.
- Data are synthetic demonstration records. These software tests establish the tested data-management behavior, not real-world fraud-detection accuracy.
- AWS/DynamoDB persistence and production authentication/authorization are not implemented.
