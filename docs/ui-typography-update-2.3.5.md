# UI 2.3.5 — Balanced investigation-profile typography

This update adjusts typography throughout the investigation profile, not just the four composite-score cards. It responds to feedback that the explanatory copy, evidence lists, and claim tables looked oversized.

## Typography targets

- Investigation body/evidence/list text: 13px, with 1.65 line height.
- Investigation table body cells: 12.5px; table headings: 10.5px.
- Component labels/contributions: 12.5px; effective weight: 12px; score values: 20px.
- Metric labels: 12.5px; metric values: 20px.
- Section headings: 15px; modal title: 24px.

All overrides are scoped to `#detailDialog`/`#detailContent`; the main dashboard typography and analytical calculations are unchanged. CSS/JS URLs and the visible UI version marker are bumped to 2.3.5 to make stale frontend assets easier to detect.

## Verification note

The production source build and static syntax/CSS structural checks are run for this pass. Actual browser-rendered visual verification must be completed on the target Windows browser.
