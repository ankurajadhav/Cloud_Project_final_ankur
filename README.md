# Healthcare Fraud Intelligence

A local, explainable healthcare-claims and referral-network analysis application. The dashboard combines specialty peer comparisons, date-window activity measurements, weighted PageRank, strongly connected components (SCCs), a transparent heuristic risk score, persistent investigation cases, and an audit trail.

**Current release: 2.3.13.** This release replaces the uninformative full-window Behavior score with a time-aware composite of recent 30-day peer-relative volume, the provider's current-vs-prior 30-day trend, and a 7-day burst comparison against the preceding 23 days. It requires at least two evaluable signals, documents minimum data thresholds, adds per-signal explanations to provider profiles, and increments the scoring model version to `hfi-2.3.3`. Other billing, referral-ring, graph, and persistent-data rules are retained.

> **Important:** all claim and provider records are synthetic demonstration data. Scores are investigative heuristics, not a calibrated probability of fraud and not evidence that a provider committed wrongdoing. Do not enter real patient identifiers or use this local-only project as a production healthcare system.

## Verified project boundaries

See [`docs/verification-report-2.3.13.md`](docs/verification-report-2.3.13.md) for the latest executed checks and [`docs/acceptance-checklist-2.3.13.md`](docs/acceptance-checklist-2.3.13.md) for the release-specific acceptance checklist. The unversioned verification/checklist files retain earlier release history.

- **Implemented locally:** Express REST API, SQLite persistence, data validation, transactional provider/claim/referral mutations, current-data analytics recalculation, investigation cases/notes, audit events, stored analytics snapshots, CSV exports, printable provider report endpoint, and responsive static frontend.
- **Seed sources:** `data/providers.json`, `data/claims.json`, and `data/referrals.json` are read only when a new empty database is initialized. Runtime changes are stored in SQLite. Startup does not replace existing rows.
- **Not implemented or claimed:** AWS/DynamoDB persistence, production authentication/authorization, live insurer integrations, real-world fraud model training or validation. The prior generated server builds and duplicated frontend copies were removed; `server.ts` plus `src/` and `frontend/` are the sources of truth.

## Windows setup (PowerShell)

Requirements: Node.js **22.13 or later** and npm. Extract the v2.3.13 ZIP to a new folder and open PowerShell in that extracted folder. Use a fresh dependency install on your own Windows machine; do not reuse a `node_modules` folder copied from another operating system.

```powershell
# Install dependencies for this computer
npm install

# Start the local app (first start imports the synthetic seed data)
npm run dev
```

Open <http://localhost:3000>. Keep the terminal running while using the site. The default database is `data/healthcare-fraud.sqlite`; override it with `HFI_DB_PATH` if preferred.

**Provider deletion behavior:** deleting a provider also deletes claims whose `provider_id` or legacy `referred_to` field references that provider, plus referral events involving the provider or linked to those deleted claims. The API reports the number of claims and referral events removed, and writes redacted per-record audit entries. A provider with investigation cases cannot be permanently deleted; deactivate it instead so case records and notes remain intact. A failed transaction or analytics recalculation rolls back the full operation.

**Confirm the correct frontend is running:** the provider profile subtitle must include `UI 2.3.13`. If not, stop any old server with `Ctrl+C`, run `npm run dev` from this extracted v2.3.13 folder, open <http://localhost:3000> and press `Ctrl+F5`. `Model hfi-2.3.3` identifies the analytics/scoring version; it is distinct from the frontend release number.

### Type-check, test, production build

Run these in the project directory:

```powershell
npm run lint
npm test
npm run build
npm start
```

`npm run dev` runs TypeScript directly. `npm run build` writes `dist/server.ts`; `npm start` serves the built server while reading the same root `frontend/` directory and SQLite file. The server binds to `127.0.0.1` by default to keep this unauthenticated demo local to the machine. Set `PORT` to change port 3000; set `HOST=0.0.0.0` only if you intentionally need remote/container access and have configured suitable access controls.

### Backup and reset

Stop the server before manually moving a database file. To create a transactionally consistent backup while the app has used SQLite WAL mode:

```powershell
npm run db:backup
# optional relative or absolute destination; destination must not already exist
npm run db:backup -- .\backups\hfi-backup.sqlite
```

**Reset deletes local data.** Stop the server first, ensure a backup exists if needed, then run:

```powershell
npm run db:reset -- --confirm-reset
npm run dev
```

Reset requires the explicit `--confirm-reset` flag, is intentionally development-only, and refuses `NODE_ENV=production`. It removes the selected database files; next startup re-imports the synthetic seed data. Do not reset to solve a routine API error.

To use a custom database path in PowerShell for the current terminal session:

```powershell
$env:HFI_DB_PATH = 'C:\\HealthcareFraud\\healthcare-fraud.sqlite'
npm run dev
```

## Architecture

```text
frontend/ (single maintained UI)
       │ HTTP / JSON
       ▼
server.ts (Express API, validation and transactions)
       ├── src/database.ts       SQLite schema, seed, audit and snapshot helpers
       ├── src/analytics.ts      Single analytics pipeline
       ├── src/statistics.ts     Provider-level peer baselines and date windows
       ├── src/graph_engine.ts   Directed topology, Tarjan SCC and weighted PageRank
       └── src/scoring.ts        Composite risk and evidence-derived explanations
                    │
                    ▼
       data/healthcare-fraud.sqlite (runtime source of truth)
```

SQLite foreign keys are enabled. Permanently deleting a provider atomically deletes claims where the provider is either the billing provider or the legacy `referred_to` provider, plus referral events involving that provider or linked to those deleted claims. Every cascaded claim/referral receives a redacted audit event; the provider deletion event records the cascade counts. Providers with investigation cases cannot be permanently deleted because cases and notes are preserved as historical evidence; deactivate those providers instead. If analytics recalculation fails, the entire provider/claim/referral deletion and audit write are rolled back. Provider deactivation preserves operational history. Claim and referral changes are applied in a transaction, audited, assigned a new data version, recalculated and snapshotted before commit. If calculation fails, the change is rolled back. The app never silently substitutes `demo_results.json` or other stale scores.


### Provider permanent-deletion policy (v2.3.6)

- Claims whose `provider_id` **or** legacy `referred_to` equals the deleted provider are deleted. This matches the application's existing definition of a claim associated with a provider.
- Referral events are deleted when either endpoint is the provider or when their `source_claim_id` references a claim being deleted. Repeated events are individually audited and removed; the graph recalculates its unique directed dependency set from the surviving events.
- Each cascaded claim gets a `DELETE_CASCADE` audit record with the synthetic patient identifier redacted; each cascaded referral gets its own `DELETE_CASCADE` event. The provider's deletion audit event includes `deleted_claims` and `deleted_referrals` counts.
- Deletion is one SQLite transaction with analytical recalculation and a snapshot. If an investigation case exists for the provider or recalculation fails, the operation is rolled back. Use **Deactivate** to retain providers that have investigation history.
- The UI confirmation explicitly warns about the cascade, and success feedback shows the actual numbers of deleted claims and referral events.

## Database tables and migrations

Schema changes are versioned in `src/migrations.ts` and are applied sequentially in SQLite transactions. The database records the schema version in `metadata`; startup applies only missing migrations and does not reseed existing data. Current schema version: 3.

- `providers`: unique ID, name, specialty, city, ACTIVE/INACTIVE status and timestamps.
- `claims`: one billed claim per unique claim ID, provider foreign key, synthetic patient identifier, amount billed, date and historical claim specialty. Optional `referred_to` is a separate descriptive field and **does not create a graph edge**.
- `referrals`: individual referral events. Repeated source/destination pairs are allowed and retained.
- `investigations` and `investigation_notes`: case workflow and notes; cases with notes cannot be permanently deleted.
- `audit_events`: operations, timestamps, entity IDs and before/after summaries. Patient identifiers are redacted from claim audit values.
- `analytical_snapshots`: model/data version, timestamp, summary and per-provider scores, for reproducible trend points.
- `metadata`: schema and analytical data version.

### Seed-data verification

The synthetic seed contains **30 providers, 1,200 claims, 80 referral events, and 66 unique directed referral pairs**. Several provider pairs have repeated event records. Initial import happens only for a genuinely new, empty database. A persistent `seed_initialized` marker prevents the application from restoring the synthetic sample if users later remove all core records; JSON seed files are not edited during normal operations.

## API overview

All API errors use JSON `{ "error": "..." }`. Validation errors are HTTP 400, missing records 404, unique/dependency conflicts 409, and unavailable live analytics 503.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/meta` | Service, SQLite, model and schema metadata |
| GET | `/api/summary`, `/api/analytics` | Current summary and scored analytics |
| GET | `/api/providers`, `/api/providers/:pid` | Provider list/filter and detail/evidence |
| POST/PATCH/DELETE | `/api/providers`, `/api/providers/:pid` | Create, update/deactivate; permanent delete transactionally cascades associated claims and referral events, while retaining investigation cases by blocking deletion |
| GET/POST | `/api/claims` | List/search and create claims |
| PATCH/DELETE | `/api/claims/:claimId` | Update/delete a claim |
| GET/POST | `/api/referrals` | List events and create a referral event |
| PATCH/DELETE | `/api/referrals/:referralId` | Update/delete one event |
| GET | `/api/graph`, `/api/fraud/rings` | Current directed graph and cyclic components |
| GET/POST | `/api/investigations` | List and create review cases |
| GET/PATCH/DELETE | `/api/investigations/:caseId` | Read/update or safely delete a case |
| POST | `/api/investigations/:caseId/notes` | Add an investigator note |
| GET | `/api/audit`, `/api/trends` | Audit events and stored analytical snapshots |
| GET | `/api/export/providers.csv`, `/api/export/claims.csv`, `/api/export/referrals.csv`, `/api/export/investigations.csv` | CSV export |
| GET | `/api/reports/provider/:pid` | Timestamped provider investigation report JSON |
| GET | `/api/reports/provider/:pid/print` | Escaped, printable provider report (browser Print / Save as PDF) |

Provider/claim/referral lists accept `q`; providers also accept `risk` and `status`. Adding `page` or `pageSize` returns a paged object; without these parameters, list endpoints retain array response compatibility. Claims support `provider_id`, `specialty`, `date_from`, and `date_to` filters. `POST /api/claims` accepts an optional `referral_targets` array (up to 100 distinct active provider IDs, excluding the claim source provider). The claim form presents these as checkboxes. `POST /api/claims` creates one linked referral event per checked target atomically and returns `created_referrals`. `PATCH /api/claims/:claimId` also accepts `referral_targets`: if supplied, it reconciles linked events to that recipient set and returns `created_referrals`, `removed_referral_ids`, `updated_referrals`, and `linked_referrals`. If `referral_targets` is omitted, existing linked referrals are preserved for backward compatibility. Changing or removing recipients only alters events whose `source_claim_id` is the edited claim; standalone/manual referral events are untouched. Claim-linked events follow the claim's current source provider and claim date. New recipients must be active; an already-linked inactive recipient can be retained or removed. The referral-management table keeps each event record, while the network graph has exactly one directed dependency per unique source/destination pair and displays the aggregated event count as edge weight.

## Analytics definitions

### Statistical comparison

For statistical comparisons, the provider's current specialty defines the peer group, but only claims whose stored historical `specialty` matches that current specialty contribute to its comparison average and normalized frequency. Historical claim specialties are never rewritten. Claims from other specialties remain in overall claim counts and billed totals but are excluded from the current-specialty peer comparison. If a provider has claims but none match its current specialty, the amount and frequency signals are reported as not evaluable. Each eligible provider contributes one matching-specialty mean to the peer distribution, excluding the assessed provider. At least **three distinct claim-bearing same-specialty peer providers** are required. The implementation does not prove that peer providers are statistically independent. Billing amount risk uses the provider mean divided by the median of peer-provider means: `ratio = provider_mean / peer_median_mean`. The score is `0` when the ratio is at or below `1`; otherwise it is `min(100, 100 × log2(ratio) / 4)`, rounded to two decimal places. The ratio itself is rounded to six decimals before scoring. This monotonic upper-tail score uses the robust median baseline. `specialty_z_score` is the signed value `(provider mean − arithmetic mean of peer-provider means) / sample standard deviation of peer-provider means`; it is diagnostic only and does not drive the final score. It is `null` if the matching-specialty mean is unavailable, fewer than three peers are available, or peer standard deviation is zero. Unusually low amounts do not increase the billing-outlier score. A zero peer median makes the ratio unevaluable even when the assessed provider mean is also zero (`0 ÷ 0` is undefined); it is not converted to a fabricated maximum or silently treated as a neutral 1× ratio.

### Time windows and behavior

The latest valid claim date in the dataset is the reproducible analysis date. Displayed 7-day and 30-day counts and billed sums include each provider’s valid claims across all stored specialties; the scored behavior component uses only claims whose preserved specialty matches the provider’s current specialty. Windows have an exclusive lower date boundary and inclusive upper boundary. The 7-day window includes the analysis date and preceding six dates; the 30-day window includes the analysis date and preceding 29 dates; the prior 30-day window is non-overlapping. Behavior uses three time-aware ratios: (1) matching-specialty claims in the current 30 days divided by the median same-specialty peer count in those same 30 days; (2) the provider’s current 30-day claim count divided by its prior 30-day count; and (3) the current 7-day claim rate (count/7) divided by the preceding 23-day rate (count/23). A signal-specific ratio is rounded to four decimals before its sub-score. Each sub-score is `clamp(100 × (ratio − 1) / 1.5, 0, 100)`, rounded to two decimals: ratios ≤1× map to 0 and ratios ≥2.5× map to 100. The nominal internal weights are 50% / 30% / 20%, renormalized over available signals. At least two signals must be evaluable to produce a behavior score. The peer signal requires at least three distinct claim-bearing same-specialty peers and a peer median of at least 3 claims over the current 30 days; the own-trend signal requires a 60-day data span and at least three claims in the preceding 30 days; the burst signal requires a 30-day span and at least three claims in the preceding 23 days. If fewer than two signals are evaluable, Behavior is `null` (not zero), and the top-level component weight is renormalized over remaining evaluated components. Date-span flags only describe date coverage, not completeness of source records. The old full-window normalized frequency remains descriptive context only and no longer drives behavior risk.

### Referral graph

- Each referral row remains an event; unique directed provider pairs are the topology edges.
- Edge weight is the number of events for that source/destination pair.
- Unique in/out degree counts distinct neighboring providers. Weighted in/out degree counts events.
- Tarjan's SCC identifies mutual reachability. A ring report is a cyclic SCC with at least three distinct providers. Two-provider cycles and a singleton self-loop are not reported as rings. A member list is not a cycle path; `cycle_path` is searched from actual graph edges.
- PageRank uses damping 0.85, event-count weighted outgoing transitions, dangling-node redistribution (including nodes whose outgoing weights are all zero), a bounded iteration count and a convergence tolerance, then normalizes rank to sum to one.
- A graph signal or SCC is investigative context, not proof of a fraudulent arrangement.

### Risk score

| Component | Weight | Meaning |
|---|---:|---|
| Billing amount anomaly | 40% | Upper-tail mean-claim-amount ratio against same-specialty peer median |
| Referral ring | 30% | Heuristic for membership in a 3+ provider cyclic SCC, inter-provider edge density and repeated inter-provider events; maximum 75 |
| Network | 20% | 60% graph-relative PageRank + 40% graph-relative incident event activity |
| Behavior | 10% | Time-aware combination of recent 30-day peer comparison, own 30-day change, and a short-window burst comparison |

For each available component, the provider detail panel shows the component score, effective weight, and contribution in final-score points. Effective weights are each available nominal weight divided by the sum of available nominal weights; the final score is their weighted average. A provider with incident referral events but no qualifying ring receives a ring signal of 0, while a provider with no incident referral evidence has ring and network components marked unavailable.

- **Billing amount:** `ratio = provider mean / median(peer-provider means)` (ratio rounded to 6 decimals); score is `0` for ratio ≤1, otherwise `min(100, 100 × log2(ratio) / 4)`. A zero peer median is unevaluable, including when both provider and peer means are zero.
- **Referral ring:** for a reportable cyclic SCC of at least three providers, `RR = min(75, 35 + 30D + min(10, 2R))`. `D = unique internal inter-provider directed edges / [n × (n − 1)]`; `R` is the sum of additional events beyond the first on those internal inter-provider edges. Self-loops are excluded from both terms. A non-member with incident referral events has signal 0; no incident evidence is unavailable.
- **Network:** `network = 0.6 × pagerank_relative + 0.4 × incident_event_relative`, where each relative term is the provider’s value divided by the current graph-wide maximum, multiplied by 100 and bounded to 0–100. Incident events are weighted incoming events plus weighted outgoing events for that provider, not the count of unique neighboring providers. The network component is unavailable if the provider has no incident referral events. PageRank itself is event-count weighted.
- **Behavior:** calculate three ratios on matching-specialty claims: (a) current 30-day claim count / median same-specialty peer current-30-day count, requiring at least three peers and a peer median of at least three claims; (b) current 30-day count / own prior 30-day count, requiring a 60-day date span and at least three claims in the prior period; and (c) current 7-day per-day rate / preceding 23-day per-day rate, requiring a 30-day span and at least three claims in the preceding 23 days. For each available ratio, sub-score is `clamp(100 × (ratio − 1) / 1.5, 0, 100)`, rounded to two decimals after the ratio is rounded to four decimals. Nominal weights are 50%, 30%, 20%, renormalized among available sub-scores. At least two signals are required; otherwise Behavior is `null`/not evaluable. The old full-observation-window activity ratio is descriptive only and is not scored.

Total billed exposure is contextual rather than a separate risk input. Overall totals can include historical claims outside the current specialty, while amount and behavior scoring use matching-specialty claims; adding a further total-volume signal could duplicate evidence. Overall risk therefore need not sort strictly by total billed amount: referral-ring and network signals can differ. If every component is unavailable, score and category are **Insufficient data**. Category thresholds are Critical ≥80, High ≥60, Medium ≥35, Low <35. These are transparent heuristic thresholds, not trained or validated cutoffs.

## Data integrity rules

- Claim amounts are interpreted as **amount billed**, not paid amount.
- Claim specialty preserves the historical specialty supplied on that claim; provider edits do not rewrite old claims.
- `claims.referred_to` is not merged into referral events, preventing accidental double-counting.
- Referral event identifiers must be unique, but repeated event pairs are accepted. Self-referrals are retained as events and included as graph self-edges; singleton self-loops are not ring reports.
- The API requires claim patient IDs to start with `PAT`, `SYN` or `DEMO`, purely to reinforce synthetic-only inputs. Do not put real identifiers in this demo application.
- All mutating inputs are validated in the backend and database constraints protect relationships; frontend validation is supplementary.

## Test suite and reproducibility

`npm test` runs the graph/statistical tests and a local HTTP integration workflow in an isolated temporary SQLite database. It checks empty/chain/cycle/two-node/self-loop graph cases, weighted PageRank normalization, repeated event aggregation, peer baseline calculations, zero variance, no-evidence scoring, CRUD validation, automatic recalculation, case notes/audit, CSV export, and persistence through a server restart. `npm run lint` type-checks the server and tests. The automated suite includes reserved-word provider IDs, historical specialty consistency, ring-risk density, self-loop handling, available-weight transparency, zero-valued explanations, migration v3, multiple claim-linked referral events, the unevaluable zero peer-median billing baseline, methodology-page formula/boundary assertions, and Z-score explanation consistency. `npm run build` builds the production source entry point for Node 22.

## Limitations

- The source data is synthetic, has a limited observation window and is not adjudicated fraud data. Seven- and 30-day date-span coverage flags are exposed in provider statistics; these flags only indicate whether available claim dates span the full period, not whether the underlying source records are complete. Percentage change against the prior 30-day period is withheld until at least 60 calendar days are spanned.
- A minimum peer count reduces some false comparisons but does not guarantee statistical validity for every clinical context. Procedure-level and risk-adjusted models are not available in this dataset.
- Claims are not tied to real insurance payments, diagnoses or validated outcomes. Data-driven explanations are traceable but not a substitute for an auditor or clinician.
- Trend snapshots preserve data version and model version. A scoring-model update can create a new snapshot without changing the data version; stored risk scores from different model versions are not directly comparable. The overview total-billed chart shows one point per data version because billed totals do not depend on the risk-scoring formula. No historical score is backfilled from old demo output.
- Local SQLite does not provide multi-instance cloud persistence. AWS deployment, authentication and production compliance controls must be built and independently verified before any non-demo deployment.


## Referral network refresh and appearance (v2.3.10)

The referral network is calculated from the current SQLite provider and referral-event tables after each successful provider, claim, or referral mutation. Live `/api/*` responses use `Cache-Control: no-store`; the browser also fetches API data with caching disabled. A dashboard refresh verifies that the health, metadata, summary, analytics and graph data versions agree, retrying if another write overlaps the load. The displayed SCC/ring panels include the analytical data version and calculation time.

The whole-network diagram preserves the previous circular provider layout; it does not rearrange nodes into SCC tiles. Every provider—including isolated providers—appears around the circle. Each unique directed source-to-destination pair is drawn once, while a `×N` badge denotes repeated referral events for that dependency. Purple nodes and edges indicate membership in a reportable cyclic SCC of three or more providers; other providers retain the original node style. Hovering or keyboard-focusing a provider highlights its direct incoming and outgoing dependencies. Larger high-contrast arrowheads indicate direction, and reciprocal A → B / B → A links use subtle opposite curves so both directions can be seen.

Creating a provider or claim alone does not necessarily change ring membership. A claim updates the network only when linked referral recipients are selected, or a separate referral event is recorded. Ring membership requires a directed cycle under the stated three-or-more-provider policy. The dashboard explains this to distinguish a correctly unchanged ring count from stale analytics.


## Referral network UI (v2.3.10)

The referral network uses one circular provider graph as the only graph visualization. The drawing includes every provider (including isolated providers), one arrow per unique directed dependency, and a `×N` badge where repeated referral events share that dependency. The referral components below/alongside the network are textual summary cards—not an alternative graph. Each card shows a verified directed cycle path, the number of unique internal dependencies, total internal referral-event count, and one chip per internal dependency.

The drawing is a readability aid, not an inference of misconduct. The graph direction follows the stored `from_provider → to_provider` relationship. Event counts represent repeated recorded referral events; the dependency/edge count counts distinct source/destination pairs.


## Arrow routing update (v2.3.11)

The circular renderer now evaluates candidate quadratic curves for each directed provider dependency. Each candidate is sampled and checked against unrelated provider circles. Colliding candidates receive a large penalty, and the selected route ends just outside the actual destination node. Reciprocal relationships prefer separated lanes and are penalized if the two paths substantially overlap. An edge can still cross another edge in a dense directed network; the router specifically prioritizes avoiding provider nodes and preserving readable arrow direction. This routing does not change the referral graph, SCCs, PageRank, referral counts, or risk formulas.


## Methodology audit update (v2.3.12)

The UI methodology page now documents the exact score curves, window boundaries, missing-data policies, and scale definitions from `src/statistics.ts`, `src/scoring.ts`, and `src/analytics.ts`. The overview trend note also distinguishes data versions from model versions, and the total-billed chart avoids duplicate points from model-only snapshots. In particular, the billing ratio is rounded to six decimals before the score curve; a zero peer-median baseline is now always unevaluable, including 0/0; Z-score is signed and diagnostic-only; descriptive rolling-window activity is distinguished from the full-dataset-window normalized frequency used by the behavior score; PageRank-relative and incident-event-relative network terms are stated explicitly; and peer records are described as distinct providers without claiming statistical independence. The analytics model version is `hfi-2.3.1` because zero-baseline scoring behavior changed. The methodology card and profile explanations also agree on the diagnostic Z-score: it remains visible when the peer median is zero if the peer means have non-zero sample variance; when the variance is zero, the signed diagnostic is explicitly reported as unavailable. The rolling windows are documented with their actual exclusive lower and inclusive upper date boundaries.


## Time-aware behavior scoring update (v2.3.13)

The previous Behavior score compared each provider's claim count across the entire observation window with the peer median. In the synthetic seed, all providers had 40 claims over the same 60-day window, so this produced the same 1× ratio and a zero score for everyone even when claim timing differed. The new model `hfi-2.3.3` uses three explicitly explained indicators: recent 30-day volume relative to same-specialty peers (50%), current vs prior 30-day own history (30%), and the current 7-day per-day rate relative to the preceding 23-day rate (20%). Each ratio is scored using the documented 1× to 2.5× linear upper-tail curve. At least two indicators must be evaluable; otherwise the Behavior component is withheld rather than inventing a zero. Profile explanations list each ratio, sub-score, evidence status, and effective internal weight. Synthetic data still does not establish real-world fraud-detection accuracy.
