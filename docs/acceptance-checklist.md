# Acceptance Checklist — Healthcare Fraud Intelligence

> **Historical checklist notice:** This is the original v2.3.5 checklist. The current v2.3.6 provider-deletion acceptance status is in [`acceptance-checklist-2.3.6.md`](acceptance-checklist-2.3.6.md).

**Review date:** 2026-10-22  
**Package version:** `2.3.5` (historical checklist) · **Model:** `hfi-2.3.0` · **Schema:** `3`

| Requirement | Status | Evidence / qualification |
|---|---|---|
| One persistent local source of truth | **Verified** | SQLite schema/migrations; API mutations persist and survive restart. |
| Create claim with multiple provider referral recipients | **Verified at API; UI syntax verified** | Checkbox-based recipient list; two recipients create two linked referral events in one transaction, source claim ID stored. Browser click-through not run. |
| Reject duplicate targets, self-recipient, missing or inactive recipients | **Verified** | API integration/regression assertions. |
| Referral-network topology shows unique dependencies only | **Verified** | Unique ordered provider pairs form graph edges; repeated events are summed into edge `event_count`. Seed: 80 events, 66 unique edges. |
| Source claim references are preserved safely | **Verified** | Schema v3 nullable `source_claim_id`; claim deletion retains event history and nulls the source link. |
| Provider, claim, referral, investigation CRUD and input validation | **Verified by tests** | SQLite-backed HTTP workflow checks creation, update, delete, validation, safe-delete policy and analytical refresh. |
| Baseline calculation uses same-specialty provider means, not individual claim values | **Verified by tests and source review** | Excludes the assessed provider; requires at least three claim-bearing peers; historical claim specialty is preserved. |
| Billing-amount risk increases monotonically with same-specialty mean-amount ratio | **Verified by unit tests** | Ratio risk: 1× = 0, 2× = 25, 4× = 50, 8× = 75, 16× or greater = 100. Diagnostic Z-score does not drive the score. |
| Total billed exposure is not double-counted | **Verified by tests and source review** | Total billed is displayed as context; claim frequency is scored separately. Total amount is not added as a duplicate score component. |
| Missing/small-sample/zero-baseline conditions are not silently treated as normal | **Verified by tests** | Unevaluable components are null; all-unevaluable providers receive `INSUFFICIENT DATA`; available weights are renormalized. |
| Final score components, effective weights, and explanations | **Verified by code and tests; browser appearance not clicked through** | UI now displays component scores, effective weights and weighted contribution points. |
| Referral-ring/SCC/cycle correctness | **Verified** | Tests cover directed chains/cycles, repeated pairs, two-node cycles, self-loops, SCC membership, and edge-valid cycle paths. Ring report requires a cyclic SCC with at least three providers. |
| PageRank normalization and score boundaries | **Verified** | Production smoke: PageRank sum ≈1, every non-null final score within [0,100]. |
| Automated suite | **2.3.5 partial verification** | 31 dependency-free tests passed directly; full HTTP integration test not rerun because Express is not installed in this clean workspace. |
| TypeScript check and production source build | **Build verified; type-check not rerun** | 2.3.5 `npm run build` passed. Type-check needs project-local TypeScript, which is not installed in this clean workspace. |
| Built-server API/static smoke | **Previous release verified; not rerun on 2.3.5** | Backend unchanged by this CSS-only update. A fresh server smoke test needs Express to be installed. |
| Investigation profile text size and layout | **Source updated; visual browser QA incomplete** | Larger typography, two-column component score cards, wider responsive dialog, cache-busted CSS/JS assets, no-cache HTML headers, and dedicated evidence scrolling are implemented in `frontend/style.css`, `frontend/index.html`, and `server.ts`. CSS delimiters, frontend JavaScript syntax, build and 31 dependency-free unit tests passed; HTTP integration/type-check/browser verification are incomplete due missing dependencies and browser QA limitations. |
| Data/report semantics | **Verified in documentation and UI text** | `claim_amount` is labeled billed amount, not amount paid; heuristic risk is not called a fraud probability. |
| Fresh `npm ci` from registry | **Not verified here** | Registry install did not complete in environment; dependencies extracted from original archive used for testing. |
| Windows PowerShell setup | **Documented, not executed** | Follow README on Windows/Node 22+. |
| Interactive browser / responsive QA | **Incomplete** | JavaScript syntax and API behaviors tested; no browser automation available for interactive form and layout verification. |
| AWS persistence, production authentication/authorization, real fraud model validation | **Not implemented** | Explicitly documented limitations; synthetic example data only. |


- [x] Final, high-specificity typography override for component cards (desktop two-column layout; mobile single-column layout).
- [x] Versioned stylesheet/script URLs and visible UI version marker to diagnose old server folders.
- [ ] Confirmed in the user's live browser: requires running the newly extracted `HealthcareFraudIntelligence-v2.3.5` folder.


## UI 2.3.5 typography adjustment

- [x] Component labels/contributions use 13px and effective weights use 12.5px.
- [x] Component values use 22px on desktop and 21px on narrow screens.
- [x] Desktop two-column component cards retained with more compact padding.
- [x] CSS/JS asset version query updated to 2.3.5; visible profile marker updated.
- [ ] Live Windows browser visual verification still requires user-side confirmation.


## UI 2.3.5 balance pass

- [x] Component label and contribution text changed to 13px.
- [x] Effective-weight text changed to 12.5px.
- [x] Component score values reduced to 22px desktop / 21px narrow screens.
- [x] Card padding and minimum height reduced without changing the two-column desktop layout.
- [x] Cache-busted CSS/JS references and visible profile marker set to UI 2.3.5.
- [x] CSS structure, expected selectors/sizes, frontend JS syntax, build and 31 dependency-free tests passed.
- [ ] Direct live-browser visual comparison and clean Windows dependency installation remain outstanding.


## Release 2.3.6 — Provider delete cascade

| Requirement | Status | Evidence / qualification |
|---|---|---|
| Delete provider cascades claims linked by `provider_id` or `referred_to` | Implemented; API integration test added | Test expects both claims removed with returned counts. |
| Delete provider removes referral events involving provider or source claims being cascaded | Implemented; API integration test added | Test covers two claim-linked referral events and one manual endpoint event. |
| Cascaded deletions recorded in audit trail | Implemented; API integration test added | Per-claim and per-referral `DELETE_CASCADE` events; patient identifiers redacted; parent audit includes counts. |
| Provider deletion with investigation cases is blocked without partial deletion | Implemented; API integration test updated | Test verifies claims and referrals remain when provider deletion returns 409. |
| Data version, analytics and snapshot update atomically | Implemented through shared `finishInputMutation` transaction | If analytics calculation fails, all cascade deletes and audit entries roll back. |
| Test execution for v2.3.6 | Pending in this environment | Full test suite is attempted after dependency availability; results documented in `docs/verification-report-2.3.6.md`. |
