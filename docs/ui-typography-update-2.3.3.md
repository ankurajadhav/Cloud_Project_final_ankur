# Investigation Profile Typography Update — 2.3.3

## What changed

- Component risk cards use two desktop columns rather than squeezing four into one row.
- Component labels are 15px, scores are 27px, effective-weight text is 13px, and contribution text is 14px.
- Composite-formula explanation is 16px with increased line height and a distinct, high-contrast explanatory surface.
- Evidence list items and explanatory details are 15.5px at desktop size.
- Narrow layouts collapse to one column at mobile widths.
- The profile subtitle displays `UI 2.3.3` separately from the unchanged analytics model `hfi-2.3.0`.
- HTML disables caching; CSS/JS use versioned query strings to prevent an old cached stylesheet from hiding the update.

## Verification performed on the packaged source

- `node --check frontend/app.js`: passed.
- `npm run build`: passed.
- CSS delimiter-balance validation: passed.
- Dependency-free tests: 31/31 passed.
- HTTP integration and project-local TypeScript check: not rerun successfully because the clean environment lacks installed Express and TypeScript packages and package installation stalled.
- Interactive browser rendering: not fully verified in this environment.

The analytics formulas and database schema were not changed in this UI-only release.

The final 2.3.3 hotfix uses explicitly scoped high-specificity CSS rules at the end of `frontend/style.css`: labels 17px, effective weight 15px, score 31px, contribution 15.5px; two columns on desktop and one below 720px. `UI 2.3.3` in the investigation subtitle confirms that the new frontend is running.
