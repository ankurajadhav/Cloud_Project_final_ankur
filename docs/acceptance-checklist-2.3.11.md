# Acceptance Checklist — Healthcare Fraud Intelligence 2.3.11

- [x] Keep previous circular provider layout.
- [x] Keep one visible edge for each unique directed dependency.
- [x] Keep repeated referral-event counts as labels.
- [x] Route candidate paths to avoid unrelated provider circles, using geometry tests against seed data.
- [x] Check that arrow endpoints stop just outside the real destination node.
- [x] Separate reciprocal routes and penalize substantial overlap.
- [x] Keep paths inside the SVG viewBox.
- [x] Preserve existing live data version, SCC/ring display and provider hover/focus behavior.
- [ ] Full API integration suite and TypeScript check in clean environment — blocked by absent installed dependencies.
- [ ] Manual visual verification in the user's Windows browser — not performed here.

## Verified seed geometry

All 66 unique directed dependencies were routed with zero sampled intersections against unrelated provider circles. This is a deterministic geometry test, not a guarantee that lines never cross each other.
