# Verification Report — Healthcare Fraud Intelligence 2.3.6

**Release:** 2.3.6  
**Analytics model:** hfi-2.3.0  
**Primary change:** provider deletion cascades to associated claims and referral events in one SQLite transaction.

## Change verified

When `DELETE /api/providers/:pid` is called:

1. The API checks whether the provider has investigation cases. If any exist, it returns HTTP 409 and does not delete the provider, claims, or referral events. Investigation cases and notes are protected historical evidence.
2. It selects claims where `provider_id` or legacy `referred_to` equals the provider ID.
3. It selects referral events where either endpoint is the provider or `source_claim_id` refers to one of those claims.
4. Each cascaded claim and referral event gets a `DELETE_CASCADE` audit entry. Claim audit payloads use `publicClaim` to redact patient identifiers. The provider deletion event records `deleted_claims` and `deleted_referrals`.
5. It removes referral rows first, then claims, then the provider. Within the existing `finishInputMutation` transaction it increments the data version, recalculates analytics, records a snapshot, and commits. Database or analytics failures roll back the complete mutation.
6. The API returns `{ provider_id, deleted, deleted_claims, deleted_referrals }`; the UI success notification shows the actual counts.

Standalone claim deletion keeps its existing semantics: claim-linked referral events survive as referral history and have `source_claim_id` cleared. Provider deletion follows the requested broader cascade policy and removes referral events tied to claims removed by that provider deletion.

## Commands executed and results

| Check | Result |
|---|---|
| Core unit tests | **31/31 passed** |
| Full `npm test`, including temporary-SQLite HTTP integration workflow | **32/32 passed** |
| `npm run lint` (TypeScript no-emit check) | **Passed** |
| `npm run build` (production source build) | **Passed** |
| `node --check frontend/app.js` | **Passed** |
| Cascade test: provider with no cases deletes associated claims/referrals | **Passed** — 2 claims and 3 referral events removed in the test scenario |
| Blocked cascade test: provider with investigation case | **Passed** — HTTP 409 and no partial deletion |
| Cascade audit verification | **Passed** — child events recorded and synthetic patient identifier absent from the audited payload |
| Dashboard count recalculation after delete | **Passed** — counts return to expected baseline after test data removal |

The tests ran on Node.js 22.16.0 in an isolated temporary SQLite database. The original supplied project dependency tree was used for verification after `npm ci` stalled in this environment; a fresh Windows dependency installation was not performed here. The ZIP excludes `node_modules` and runtime databases.

## Remaining limitations

- Full interactive testing on the user's Windows browser was not performed in this environment.
- A provider that has one or more investigation cases cannot be permanently deleted. Deactivate it instead; this is intentional to preserve case history and notes.
- The example dataset is synthetic. Tests establish software behavior and internal consistency, not real-world fraud-detection accuracy.
- AWS persistence, production authentication/authorization, and validation against independently adjudicated fraud labels remain outside the implemented local scope.
