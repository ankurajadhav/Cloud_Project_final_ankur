# Verification report — Healthcare Fraud Intelligence v2.3.12

## Summary

The “Methodology & model notes” page and associated scoring explanations were reviewed against `src/statistics.ts`, `src/scoring.ts`, `src/graph_engine.ts`, `src/analytics.ts`, `server.ts`, and the overview trend rendering. Several documentation gaps were corrected, and one real scoring edge-case mismatch was fixed.

## Corrections made

1. **Peer wording is precise.** Peer reference groups are described as distinct providers; the app does not claim those providers are statistically independent. The same wording is used in the live analytics summary and profile explanations.
2. **Zero peer-median baseline.** `safePeerRatio` now returns `null` for any zero baseline, including `0 / 0`; it no longer invents a neutral 1× ratio. The billing component is therefore unavailable rather than falsely neutral or maximally risky. The scoring model version is `hfi-2.3.1` to distinguish snapshots produced under this changed behavior.
3. **Signed Z-score explained correctly.** The signed Z-score is diagnostic only, can be negative, and does not affect the composite score. It is shown even when the peer median is zero if peer means have a non-zero sample standard deviation. If peer means have zero sample standard deviation, the UI explanation says the diagnostic is unavailable.
4. **Activity windows and behavior scoring separated.** The page distinguishes descriptive all-specialty 7-/30-day counts and billed sums from the current-specialty peer-relative behavior score. Exact window boundaries are documented: (end − 7 days, end] for the 7-day view and (end − 30 days, end] for the 30-day view; the prior 30-day window is shifted back 30 days and does not overlap. The dataset observation span is based on valid claim dates and does not prove the input data is complete.
5. **Rounding documented.** Amount ratio is rounded to six decimal places before its score curve; normalized frequencies and activity ratios are rounded to four decimals; score components and the final score are rounded to two decimals.
6. **Network and ring formulas documented.** The Methodology page now states the 60/40 normalized PageRank/incident-event network formula, the ring-risk formula and maximum of 75, the definition of `n`, self-loop exclusion from ring density/repeat bonus, available-component weight renormalization, and risk-category thresholds.
7. **Snapshot versions described accurately.** Documentation distinguishes data versions from model versions; a model update can create a new snapshot without data mutation. Risk scores from different model versions are not directly comparable; the total-billed overview trend deduplicates model-only snapshots.
8. **Provider-facing explanation fixed.** The signed Z-score is explained independently from the amount-ratio billing score, preventing a valid diagnostic from being hidden merely because the amount ratio is unevaluable.

## Checks executed

| Check | Result | Notes |
|---|---|---|
| `npm test` | **PASS — 44/44 tests** | Includes graph, statistical, scoring, DB migration/initialization, SQLite-backed API integration, frontend graph, and methodology accuracy tests. |
| `npm run lint` | **PASS** | TypeScript compiler completed with `--noEmit`. |
| `npm run build` | **PASS** | Production source build completed; generated `dist/` is excluded from the source ZIP. |
| JavaScript/TypeScript syntax checks | **PASS** | `frontend/app.js`, methodology test, server, `src/*.ts`, and `tests/*.test.ts`. |
| Production-start smoke test | **PASS** | Built server ran on a temporary database; `/`, `/api/health`, `/api/summary`, `/api/analytics`, and `/api/trends` responded successfully. Temporary DB was removed. |
| Seed count check | **PASS** | 30 providers, 1,200 claims, 80 referral events, 66 unique directed relationships, 2 reportable rings. |
| Methodology formula regression tests | **PASS** | Check UI formulas and boundary rules against source wording, zero-baseline handling, and model version. |
| Fresh registry dependency installation | **BLOCKED / not verified** | `npm install` stalled in this environment. Tests and TypeScript checks used compatible dependencies from the originally supplied archive for verification only; no dependency folders are included in the deliverable. |
| Visual browser review | **NOT COMPLETED** | Source and HTTP responses were verified, but a final human visual review in a browser was not performed. |
| Real-world fraud detection accuracy | **NOT ESTABLISHED** | The dataset is synthetic and has no independently adjudicated fraud outcomes. |

## Important interpretation limits

The methods are deterministic heuristics that prioritize review, not calibrated fraud probabilities. The specialty peer comparison requires at least three distinct claim-bearing peers, but that minimum does not establish statistical independence or clinical comparability. The current data does not adjust for procedure code, case complexity, contract terms, or risk-adjusted patient mix. The date-span completeness flags only say that claim dates span the corresponding interval; they do not prove all records were ingested.

## Reproducibility

The ZIP includes source files, lockfile, tests, data seed JSON, migrations, build/reset/backup scripts, and this report. It excludes `node_modules`, generated `dist/`, local SQLite files, and secrets. On Windows, use Node.js 22.13 or later, run `npm install`, then `npm run lint`, `npm test`, and `npm run build`.
