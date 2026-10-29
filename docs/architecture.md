# Architecture and trust boundaries

The local development target is a single Node.js 22+ process serving the static frontend and Express API on port 3000. `server.ts` is the API source of truth; `src/migrations.ts` applies versioned SQLite migrations; `src/database.ts` opens SQLite; `src/analytics.ts` coordinates one deterministic pipeline; `src/statistics.ts`, `src/graph_engine.ts` and `src/scoring.ts` own the individual algorithms. `frontend/` is the only maintained UI directory. The generated server build is written to `dist/server.ts` by `scripts/build.mjs`.

## State lifecycle

Migrations are ordered and run once inside transactions; schema version is kept in the `metadata` table. Schema version 3 adds nullable `referrals.source_claim_id`, which links an automatically created referral event to the claim that generated it; deleting a claim retains the referral event and clears that link. Re-running initialization is idempotent and existing records are not re-seeded.

1. On a new empty database, controlled import seeds `data/providers.json`, `data/claims.json` and `data/referrals.json` in a single transaction.
2. Normal reads always use SQLite. JSON is not a second writeable store and is never imported over an existing DB.
3. A provider, claim or referral mutation validates fields and relationships, opens `BEGIN IMMEDIATE`, writes the change and audit entry, increments `metadata.data_version`, calculates analytics from records read inside that transaction, records a snapshot, and commits. Creating a claim may include a `referral_targets` array. Each distinct active, non-self provider target becomes one `referrals` event from the claim's provider with `source_claim_id` and the claim date. All referral inserts, audit events, analytics and the claim commit or roll back together.
4. If the write or analytic calculation fails, the transaction is rolled back. Old calculated data is never returned as if recalculated from changed inputs.
5. Investigation workflow and note mutations are also transactional and audited. Case status does not feed the scoring model, but the current overview case counter refreshes.

## Graph semantics

The graph contains all provider nodes (including inactive providers, to preserve historical network context). Statistical amount and comparative-frequency peer signals use only claims whose preserved claim specialty matches the provider’s current specialty; all valid claims still contribute to overall claim counts and billed totals. It aggregates repeated event pairs to a single topological edge but records pair event frequency as its weight. Tarjan SCC uses the unique directed topology. PageRank uses weighted transitions and a normalized stationary vector. Repeated event pairs increase the weight but do not duplicate topology. Ring risk excludes self-loop edges from inter-provider density. Provider IDs are treated as data keys with explicit own-property checks to avoid collisions with JavaScript object prototype properties. Ring reporting additionally requires a cyclic SCC with at least three distinct vertices. UI cycle paths are found from graph edges; the SCC's internal edges are also included.

## Local deployment status

Only local SQLite has been implemented. The AWS documents are descriptions of future work, not proof of a deployed cloud application. Do not deploy this SQLite database to an ephemeral multi-instance Lambda runtime and expect durability or shared writes. A cloud deployment needs a separate persistent data adapter and explicit IAM/network/deployment configuration.


## Provider deletion and dependent data (release 2.3.6)

The provider DELETE API uses an explicit transaction rather than relying on provider-table `ON DELETE CASCADE` rules because investigation cases must remain protected. It first rejects permanent deletion if the provider has any investigation case; this check occurs within the transaction. Otherwise it selects claims where `provider_id` or legacy `referred_to` matches the provider, then selects referral events involving the provider or whose `source_claim_id` references one of those claims. It writes per-record `DELETE_CASCADE` audit events (claim audit payloads redact patient identifiers), removes referral events before claims to satisfy foreign keys, removes the provider, records the parent deletion summary, increments `data_version`, recalculates analytics, writes a snapshot, and commits. Any database or analytics error rolls back the entire mutation. Manual deletion of a claim remains different: it preserves independent referral-event history by setting `source_claim_id` to NULL; provider deletion explicitly removes the associated referral events per the requested lifecycle policy.
