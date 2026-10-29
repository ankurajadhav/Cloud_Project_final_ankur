# Acceptance checklist — Healthcare Fraud Intelligence v2.3.12

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Methodology page describes the implemented billing amount ratio and score curve | **Verified** | Formula plus 6-decimal ratio rounding; tests compare page/source behavior. |
| Zero peer median is unevaluable, including 0/0 | **Verified** | `safePeerRatio` returns null for zero baseline; regression test and model version `hfi-2.3.1`. |
| Signed diagnostic Z-score is explained accurately | **Verified** | Negative scores allowed; diagnostic-only; shown when calculable even if billing ratio unavailable; zero sample variance explained. |
| Peer group is described as distinct providers, not proven independent providers | **Verified** | Methodology page, README, profile explanation, and analytics metadata aligned. |
| 7-/30-day descriptive windows and prior period have accurate boundaries | **Verified** | Exclusive lower/inclusive upper boundaries documented; source date-boundary tests pass. |
| Behavior risk formula and rounding match source | **Verified** | Full-window matching-specialty peer normalization; four-decimal frequency/ratio; two-decimal score. |
| Network-risk formula and unavailability rule are documented | **Verified** | 60% normalized PageRank + 40% normalized incident-event score; code-backed formula tests. |
| Ring risk formula, density denominator, repeated-event bonus and cap are documented | **Verified** | Defines `n`, excludes self-loops from inter-provider density/bonus; formula maximum is 75. |
| Composite score and missing-component policy are documented | **Verified** | Available components are weight-renormalized; observed zero is retained; all missing means score withheld. |
| Risk thresholds match backend | **Verified** | Critical ≥80, High ≥60, Medium ≥35, otherwise Low; insufficient data is separate. |
| PageRank settings match the implementation | **Verified** | Damping 0.85, event-count weighted transitions, dangling mass redistribution, 200 iterations, 1e-10 tolerance, normalized result. |
| Model/data snapshot versions described accurately | **Verified** | Model-only snapshots noted; cross-model risk-score comparisons cautioned. |
| Automated suite | **Verified** | `npm test`: 44/44 passed. |
| TypeScript check | **Verified** | `npm run lint` passed in verification environment using compatible dependencies from provided archive. |
| Production build | **Verified** | `npm run build` passed. |
| Production HTTP startup | **Verified** | Built server smoke test passed on temporary SQLite DB; seed metrics matched. |
| Fresh `npm install` on a clean Windows machine | **Not verified** | Registry install stalled here; rerun on target machine. |
| Final visual browser review | **Not completed** | Inspect Methodology & model notes in the local browser after extraction. |
| Real-world predictive performance | **Not established** | Synthetic dataset only; no adjudicated labels or calibration study. |
| AWS persistence / production healthcare deployment | **Not implemented** | Do not interpret local test results as cloud-readiness or production certification. |
