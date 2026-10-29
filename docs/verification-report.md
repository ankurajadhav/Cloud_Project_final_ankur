# Verification Report — Healthcare Fraud Intelligence

> **Historical report notice:** This document records the v2.3.5 typography-only release. For the current v2.3.6 provider-deletion behavior and checks, read [`verification-report-2.3.6.md`](verification-report-2.3.6.md).

**Verification date:** 2026-10-22  
**Application/package version:** `2.3.5` (historical report)  
**Analytics model version:** `hfi-2.3.0`  
**SQLite schema version:** `3`  
**Runtime tested:** Node.js `v22.16.0`, npm `10.9.2`, Linux container

## Results

| Check | Result | Evidence / qualification |
|---|---|---|
| Automated dependency-free tests | **PASS — 31/31 on current 2.3.5 source** | Ran `graph_engine`, `statistics`, `scoring`, `database_migrations`, and `database_init` tests directly with Node 22; all 31 passed. The HTTP integration file was not rerun because Express is not installed in this clean workspace. |
| Full `npm test` including API integration | **PARTIALLY VERIFIED** | The 31 dependency-free tests pass. The separate HTTP integration test needs the project's Express dependency; no fresh full-suite pass is claimed for this package. |
| TypeScript type-check (`npm run lint`) | **NOT RERUN in this clean workspace** | Project-local TypeScript is not installed because dependency installation was unavailable here. The earlier logic release's type-check passed. |
| Source production build (`npm run build`) | **PASS — current 2.3.5** | Created the `dist/` source runtime tree. This project intentionally uses Node 22 type stripping rather than compiling to a bundle. |
| Frontend JavaScript syntax (`node --check frontend/app.js`) | **PASS — current 2.3.5** | No syntax errors. |
| CSS structure, required font-size selectors, versioned assets | **PASS — current 2.3.5** | Checked CSS brace balance, expected component card sizes (13px labels/contributions, 12.5px effective weights, 22px scores), `style.css?v=2.3.5`, `app.js?v=2.3.5`, and visible `UI 2.3.5` marker. |
| Built-server HTTP smoke test | **PREVIOUS RELEASE PASS — 20/20 routes; not rerun for 2.3.5** | Backend code was not changed in this UI-only release. A fresh API smoke test requires the Express dependency. |
| Seed and graph invariants | **PASS** | 30 providers, 1,200 claims, 80 referral events, 66 unique directed relationships, and 2 reported 3+ provider cyclic SCCs. Network edge count matches unique ordered provider pairs. |
| Score and graph invariants | **PASS** | Every non-null score is in `[0,100]`; PageRank sums to `1.0000000000000002` (floating-point rounding around 1); every reported ring cycle path closes and every consecutive path edge exists in the graph. |
| Claim with multiple referral recipients | **PASS — API integration** | Creating one claim with two distinct targets persisted two referral events, with the new claim ID as provenance, within the same transaction. Duplicate recipients and self-recipient are rejected. |
| Unique dependency vs repeated events | **PASS — API integration** | `/api/graph` contains one directed edge per unique source/destination pair; repeated events aggregate into `event_count`. Editing a manual referral onto an existing linked pair increments its event count without adding another graph edge. |
| Persistent data and migrations | **PASS** | Fresh schema v3, upgrade from version 1, future-schema rejection, CRUD recalculation and restart persistence tested. Claim deletion preserves linked referral events and clears `source_claim_id` as defined by the foreign key. |
| Fresh registry install (`npm ci`) | **NOT VERIFIED** | Package-registry installation did not complete in this environment. Tests/build used dependencies extracted from the originally supplied archive. A clean install should be confirmed on the target Windows machine. |
| Interactive browser and responsive QA | **NOT COMPLETED** | The checkbox-based multi-recipient form and score-contribution UI pass JavaScript syntax validation and their API semantics are covered by integration tests, but no automated real-browser click-through was available. |
| Windows PowerShell workflow | **NOT EXECUTED HERE** | Commands are documented in README; run them on Windows to confirm host-specific behavior. |
| AWS/cloud persistence and production healthcare security | **NOT IMPLEMENTED** | Only the local SQLite workflow is implemented. No AWS adapter, production authentication/authorization, or validated real-world fraud model is claimed. |

## 2.3.3 investigation-profile typography and cache update (historical release)

This release changes presentation and asset-cache handling only; the analytics model remains `hfi-2.3.0` and the SQLite schema remains version 3. The investigation modal is wider, score-component cards use a two-column desktop layout, card labels are 15px, component values are 27px, effective-weight text is 13px, and point contributions are 14px. Explanatory text is 16px with increased line-height. Narrow screens switch to a single column where needed. The profile subtitle displays `UI 2.3.3` separately from the unchanged analytics model version.

To prevent the exact stale-style symptom reported, `index.html` references `style.css?v=2.3.3` and `app.js?v=2.3.3`; static HTML responses send no-cache headers so an old HTML shell must revalidate. `node --check frontend/app.js` **passed**, `npm run build` **passed**, a CSS delimiter-balance check **passed**, and all 31 dependency-free unit tests **passed** on this patch. HTTP integration and project-local TypeScript checking remain blocked in this environment because package installation stalled and Express/TypeScript are not present in `node_modules`. Real-browser visual testing remains incomplete and should be confirmed after a fresh Windows dependency install.

## Referral workflow changes

The claim form lets an operator check multiple active recipient providers in one operation. On the server, `referral_targets` is validated as a unique array of up to 100 provider IDs; missing or inactive providers, repeated target IDs, and self-recipient IDs are rejected. The claim and all linked referral event rows are written in one transaction. Each generated event stores its `source_claim_id` and the claim date, and individual events are audit logged.

Referral events remain separate records so repeated activity is preserved. Graph topology, SCC membership, degree, and the dashboard's unique relationship count use **one directed dependency per unique ordered `(from_provider, to_provider)` pair**. The edge's `event_count` and weighted network calculations preserve event frequency. The `claims.referred_to` legacy field is not independently merged into the referral graph, preventing accidental double-counting.

## Scoring methodology audited

All scores are heuristic prioritization measures, not validated fraud probabilities.

1. **Billing-amount anomaly (40% nominal weight).** Calculate the assessed provider's average amount for claims whose stored specialty matches the provider's current specialty. Divide by the median of independent peer-provider average amounts in the same specialty, excluding the assessed provider. At least three claim-bearing peers are required. Let `r` be this ratio. Risk is `0` for `r <= 1`; otherwise `min(100, 100 * log2(r) / 4)`. Thus 2× = 25, 4× = 50, 8× = 75, and 16× or greater = 100. Low amounts do not increase this upper-tail signal. A zero baseline with positive amount, no matching claims, or too few peers is reported as unevaluable rather than fabricated as zero or maximum risk. The conventional Z-score remains diagnostic only and never drives the billing score.
2. **Referral-ring signal (30% nominal weight).** A reportable ring is a cyclic SCC with at least three distinct providers. For a qualifying component, `RR = min(75, 35 + 30D + min(10, 2R))`, where `D` is unique inter-provider directed-edge density divided by `N(N-1)` and `R` is the number of repeated events beyond the first on those internal inter-provider edges. Self-loops do not inflate density or repeat bonus. If referral evidence exists but no qualifying ring is detected, ring risk is `0`; if there is no incident referral evidence, this component is unavailable.
3. **Referral-network signal (20% nominal weight).** Uses 60% normalized PageRank and 40% normalized incident referral-event activity relative to the current graph. It is a relative network signal, not evidence of wrongdoing by itself.
4. **Comparative behavior (10% nominal weight).** Compares 30-day-normalized claim frequency to the same-specialty peer median. The heuristic is `clamp(((ratio - 1) / 1.5) * 100, 0, 100)`: at or below 1× it is 0; at 2.5× or greater it is 100. It requires the same peer-evidence conditions. Absolute volume alone is not a fraud finding.

The final score is the weighted mean of the available components, using nominal weights 40% / 30% / 20% / 10%. When one or more components are unavailable, available weights are renormalized to sum to 100%; an observed zero is a valid score, not missing data. Category cutoffs are Critical `>=80`, High `>=60`, Medium `>=35`, and Low `<35`. If all components are unavailable, the result is `INSUFFICIENT DATA`.

Total billed amount is shown as contextual exposure but is **not added as a second independent billing score**, since it is the product of average amount and claim count; that would duplicate evidence when claim counts are equal. The behavior component separately compares claim frequency. Provider peer comparisons use only claims tagged to their current specialty; historical claim specialties and all-record totals are preserved.

## What the “higher billed amount, lower overall risk” example means

On the supplied synthetic records, both providers below have 40 claims, so the totals and mean per-claim amounts have the same ordering:

| Provider | Specialty | Total billed | Mean billed / claim | Amount ratio vs peer median | Billing component | Ring | Network | Behavior | Final score |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| P015 | Orthopedics | ₹1,839,790.06 | ₹45,994.75 | 14.16× | 95.60 | 0 | 50.14 | 0 | 48.27 (Medium) |
| P008 | Orthopedics | ₹1,652,726.74 | ₹41,318.17 | 12.72× | 91.73 | 55 | 80.24 | 0 | 69.24 (High) |

P015 does have the higher billing-amount risk score. P008's final score is higher because P008 has a qualifying referral-ring signal and substantially higher network signal; their weighted contributions outweigh its slightly lower billing component. This is **not** an arithmetic reversal of the billing signal. The investigation panel now displays each component's score, effective weight, and point contribution so the difference can be traced. It would be methodologically unsound to force final scores to sort only by total billed amount when the product is explicitly a multi-signal model. Claim amounts represent billed amounts, not confirmed insurer payments.

## Current seeded baseline after the revised model

| Metric | Value |
|---|---:|
| Providers | 30 |
| Claims | 1,200 |
| Total billed amount | ₹21,548,281.30 |
| Referral events | 80 |
| Unique directed referral relationships | 66 |
| Reported cyclic SCCs with 3+ providers | 2 |
| Critical / High / Medium / Low | 0 / 4 / 5 / 21 |

## Limitations

These checks verify reproducible code paths and internal consistency over synthetic data. They do not establish real-world fraud-detection precision, recall, calibration, legal validity, clinical appropriateness or insurer acceptance. Peer comparisons do not yet control for procedure code, case complexity, provider contracts, geography, or clinically adjusted expectations. The sample has at least one specialty with too few independent providers for an amount peer score, which is deliberately marked unevaluable. Windows installation, real browser click-through, AWS persistence, production authentication/authorization, and evaluation against adjudicated labels remain outstanding.


## UI 2.3.3 typography hotfix

This follow-up makes the component-card styles use high-specificity, explicitly scoped rules at the end of the stylesheet. On desktop the four score components render as two columns, with 17px labels, 15px effective-weight text, 31px scores and 15.5px contribution text. At widths below 720px they become one column. The page uses `style.css?v=2.3.3` and `app.js?v=2.3.3`; the HTML shell is configured not to cache. The profile subtitle displays `UI 2.3.3`, which is an intentional diagnostic to distinguish this frontend from older copies still running on localhost.


### UI hotfix verification (2.3.3)

- Passed: 31 core automated tests (`graph_engine`, `statistics`, `scoring`, `database_migrations`, `database_init`).
- Passed: production source build (`node scripts/build.mjs`).
- Passed: frontend JavaScript syntax (`node --check frontend/app.js`).
- Passed: stylesheet structural validation and checks for the 2.3.3 versioned asset URLs, visible UI version marker, and high-specificity component-card selectors.
- Not re-run in this clean workspace: HTTP integration tests and TypeScript type-check; package dependencies (`express` and TypeScript type definitions) are excluded from the ZIP and could not be installed here.
- Not verified: the user's live browser. The provided screenshot still displays a four-card single row and omits `UI 2.3.2`, which indicates the browser is showing an older source folder/server, not the prior 2.3.2 frontend package. The 2.3.3 ZIP has a distinct root directory to prevent accidental reuse of that old folder.


## 2.3.5 balanced component typography

This UI-only update addresses the report that the 2.3.3 component cards became too large. The final high-specificity CSS now sets component labels and contribution text to 13px, effective-weight text to 12.5px, and the score value to 22px desktop / 21px narrow-screen. Card minimum height and padding were reduced while retaining the two-column desktop layout. The analytics model and schema are unchanged. `index.html` uses versioned `style.css?v=2.3.5` and `app.js?v=2.3.5` URLs, and the investigation subtitle shows `UI 2.3.5`.

The live user's browser was not accessible for direct screenshot comparison; verification is limited to source/asset checks and tests recorded for this release.


## 2.3.5 balanced component-card typography

The latest UI-only refinement reduces the component cards from the oversized 2.3.3 values to a normal reading scale: 13px component labels, 12.5px effective-weight text, 22px score values on desktop (21px on narrow screens), and 13px contribution text. Cards use a compact 142px minimum height and 16px × 18px desktop padding, preserving the two-column layout. Analytics formulas, API behavior, and database schema are unchanged.

Version-specific stylesheet/script URLs and the visible profile marker were bumped to 2.3.5. Verified on source: `node --check frontend/app.js` passed; the 31 dependency-free tests passed; `npm run build` passed; CSS balance, requested declarations and version markers passed. Real browser rendering, Windows-specific behavior, the HTTP integration test and the project-local TypeScript check were not independently verified in this clean environment.
