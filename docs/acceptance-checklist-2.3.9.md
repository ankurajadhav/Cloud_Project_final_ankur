# Acceptance Checklist — Healthcare Fraud Intelligence 2.3.9

- [x] Restored the previous circular network layout (no SCC tile/group layout).
- [x] All providers remain visible, including isolated providers.
- [x] Directional arrowheads are larger and higher-contrast.
- [x] Reciprocal dependencies curve away from one another; one-way dependencies remain straight.
- [x] Reportable-ring highlighting is preserved from the prior graph; non-ring providers keep the prior node style.
- [x] Repeated referral events are retained and shown as edge-count labels; graph topology remains one edge per unique directed dependency.
- [x] Hover/focus on a provider highlights its connected links.
- [x] Current data version, calculation timestamp, no-cache reads, and dynamic ring refresh are retained.
- [x] Frontend assets and visible release marker are versioned as 2.3.9.
- [x] Automated tests: 35/35 passed.
- [x] Type-check, production build, frontend syntax, CSS structure and 7-route production smoke test passed.
- [x] Headless Chromium rendered the frontend using API response snapshots from the running app: 30 nodes, 66 edges, 2 arrow marker types, and no page errors.
- [ ] Manual click-through in the target Windows browser: not performed here.

See `verification-report-2.3.9.md` for the detailed test evidence.
