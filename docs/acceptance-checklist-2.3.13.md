# v2.3.13 Acceptance Checklist

| Requirement | Status | Evidence / notes |
|---|---|---|
| Replace uninformative full-window Behavior scoring | **Verified** | `src/statistics.ts`; regression test for distinct timed activity |
| Include 30-day peer-relative activity | **Verified** | Minimum three distinct claim-bearing same-specialty peers; peer median must be at least three current-window claims |
| Include current 30-day vs prior 30-day trend | **Verified** | Requires at least 60-day dataset span and three prior-period matching-specialty claims |
| Include recent 7-day burst vs preceding 23-day rate | **Verified** | Requires 30-day span and three baseline claims in preceding 23 days |
| Require two evaluable signals before scoring behavior | **Verified** | Returns null when fewer than two; avoids fabricated zero-risk evidence |
| Renormalize weights across available behavior signals | **Verified** | 50% / 30% / 20% nominal weights are renormalized over evaluable signals |
| Keep API/frontend/explanations aligned | **Verified** | Provider rows expose `behavior_breakdown`; tests assert methodology/source consistency |
| Bump scoring model version | **Verified** | `hfi-2.3.3` |
| Automated test suite | **Verified** | 44/44 passed |
| TypeScript type-check | **Verified** | `npm run lint` passed |
| Production source build | **Verified** | `npm run build` passed |
| Frontend JavaScript syntax | **Verified** | `node --check frontend/app.js` passed |
| Built-server smoke test | **Verified** | Temporary SQLite DB; health/summary/analytics/frontend assets checked |
| Fresh Windows installation and manual visual review | **Not verified** | Must be checked on the target machine |
| Real-world fraud accuracy/calibration | **Not established** | Synthetic dataset has no adjudicated fraud labels |
