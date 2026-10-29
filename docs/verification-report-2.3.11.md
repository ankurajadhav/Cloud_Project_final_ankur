# Verification Report — Healthcare Fraud Intelligence 2.3.11

## Purpose

This release addresses referral arrows that sometimes visually passed through unrelated provider nodes or appeared to point unclearly. The circular layout, unique directed dependency model, and live ring-refresh behavior are preserved.

## Implemented

- Added a deterministic quadratic-edge routing helper.
- Samples each candidate path and scores its minimum clearance from all unrelated provider circles.
- Applies a strong penalty to node collisions, with a six-pixel clearance gutter.
- Keeps the sampled route within the SVG viewBox.
- Routes reciprocal dependencies in separated lanes and penalizes substantial reverse-path overlap.
- Clips the path to a point just outside the actual target circle, so the marker points at the intended provider.
- Adds route-bend/collision metadata to edge elements for diagnostics.
- Preserves unique dependency edges, event-count badges, SCC highlight, and current-data freshness.

## Checks executed

- Frontend source JavaScript syntax check: PASS.
- Frontend graph tests: 4/4 PASS, including a geometry test against the bundled seed data that checks all 66 unique directed dependencies for intersections with unrelated provider circles and checks target endpoint offsets.
- Production source build: PASS.
- CSS/JS version marker consistency: checked.

## Scope and limitations

The routing check concerns edge paths crossing provider-node circles. Crossings between two edges may still occur in a dense/non-planar graph; the algorithm does not invent or remove referral relationships and does not guarantee a crossing-free graph. The full API integration suite, type-check, and live Windows browser test were not run in this environment because the clean package excludes `node_modules` and dependency installation was not assumed to have succeeded. Install dependencies on the target Windows machine and run `npm run lint`, `npm test`, and `npm run build`.

All bundled records are synthetic. This visual routing change does not modify statistical calculations, SCC membership, PageRank, risk scores, or persistence behavior.
