# UI 2.3.5 verification report

## Scope

Typography/layout-only update to the investigation-profile modal. No analytics formulas, storage, API contracts, or database schema were changed.

## Checks completed

- `node --check frontend/app.js`: passed.
- `node scripts/build.mjs`: passed; production source files copied to `dist/`.
- CSS structural check: passed (balanced opening/closing braces, current UI markers, and required scoped selectors found).
- Core dependency-free tests using Node.js type stripping: **31 passed, 0 failed**.
  Command: `node --experimental-strip-types --test tests/graph_engine.test.ts tests/statistics.test.ts tests/scoring.test.ts tests/database_migrations.test.ts tests/database_init.test.ts`.
- CSS asset URL and JavaScript UI version marker both identify `2.3.5`.

## Not verified in this run

- API integration test and full TypeScript type-check were not run because this clean source folder does not include `node_modules`; dependency installation was not performed for this typography-only change.
- A live browser screenshot was not produced in this environment. Please verify the rendered dialog on the target Windows browser after installing dependencies and starting the server.

## Result

Static checks and the core test set passed. Do not interpret this as a complete end-to-end or live-browser visual certification.
