# Healthcare Fraud Intelligence v2.3.13 — Verification Report

## Scope

This release replaces the previous full-window Behavior component with a time-aware, evidence-gated score. The backend, analytics API, profile explanations, Methodology page, README, and tests use model version `hfi-2.3.3`.

## Changes verified

- Behavior scoring uses three current-specialty signals: (1) recent 30-day claims relative to the median for distinct same-specialty peers (nominal 50%), (2) the provider's current 30 days relative to the preceding non-overlapping 30 days (30%), and (3) the rate over the latest 7 days relative to the preceding 23-day rate (20%).
- Each signal's ratio is rounded to four decimal places before scoring. Its one-sided increase score is `round2(clamp(100 × (ratio − 1) / 1.5, 0, 100))`; ratios at or below 1 score 0 and ratios at or above 2.5 score 100.
- At least two of three signals must be evaluable. Available internal weights are renormalized. Fewer than two signals returns `null`, not zero.
- Minimum-evidence criteria and exact time-window boundaries are described in the Methodology page and README. Profile explanations expose per-signal ratios, scores, available weights, and why a signal could not be evaluated.
- The old normalized full-observation-window frequency remains descriptive context and no longer drives Behavior risk.
- Model version changed to `hfi-2.3.3` to distinguish scores calculated by the new method.

## Commands and actual results

| Check | Result |
|---|---|
| `npm test` | **PASS — 44/44 tests** |
| `npm run lint` | **PASS — TypeScript type-check** |
| `npm run build` | **PASS — production source build** |
| `node --check frontend/app.js` | **PASS** |
| Production-start HTTP smoke test using a temporary SQLite DB | **PASS** |
| ZIP integrity check | **PASS** — `unzip -t` reported no archive errors; dependency folders, local databases, and Git metadata are excluded |

The automated suite includes a SQLite-backed HTTP integration workflow, graph algorithm tests, statistical boundary cases, independently checkable formula tests, methodology/source consistency checks, and the time-aware Behavior comparisons.

## Production smoke-test observation

The built `dist/server.ts` was started with a fresh temporary SQLite database and a non-default port. Health, summary, analytics, UI shell, and versioned frontend JavaScript routes responded. Returned values:

- Model version: `hfi-2.3.3`
- Providers: 30
- Claims: 1,200
- Referral events: 80
- Unique directed relationships: 66
- Reportable rings: 2
- Every analytics provider row included `behavior_breakdown`
- API summary response used `Cache-Control: no-store`
- Served JavaScript contained the `UI 2.3.13` marker

The temporary database was isolated from the normal local user-data path.

## Seed-data behavior-score sanity check

Directly recalculating analytics using `data/providers.json`, `data/claims.json`, and `data/referrals.json` returned 30 Behavior scores, with 29 statuses `EVALUATED` and one status `PARTIAL_EVIDENCE` (two signals evaluable). Scores ranged from 0 to 38.2; 23 were positive and 7 were zero. There were 16 distinct score values. This confirms the score no longer becomes zero for all providers simply because their full-window claim counts are equal. A zero remains valid when all evaluable ratios are at or below baseline; it is not evidence of no fraud.

These are deterministic outputs from the synthetic demonstration dataset, not measured fraud-detection performance.

## Interpretation and limitations

- The date windows are anchored to the latest valid claim date in the stored dataset for reproducibility, not the wall-clock date. The lower date boundary is exclusive and the upper boundary inclusive.
- Historical claim specialties are preserved. Time-aware Behavior signals compare claims whose recorded specialty matches the provider's current specialty.
- Date-span checks show that records cover a number of dates; they cannot prove that all underlying claims were captured. The data may have incomplete records or reporting delays.
- The ratio curve and 50/30/20 internal weights are explicit heuristics, not coefficients trained against adjudicated fraud labels. They are not calibrated probabilities.
- Lower activity ratios do not increase Behavior risk; the current component is intentionally an upper-tail activity-increase signal.
- Synthetic examples do not validate precision, recall, calibration, or clinical appropriateness. Before real use, parameters and thresholds would require domain review and validation on appropriately governed, adjudicated data.
- A fresh Windows dependency installation and a manual click-through in the user's browser are not independently verified in this environment.
