# Investigation Profile Typography Update — 2.3.4

This is a UI-only refinement of the investigation-profile component cards. Analytics formulas, database schema, and API behavior are unchanged.

## Component card sizing

- Component labels: 13px.
- Effective-weight line: 12.5px.
- Component score value: 22px on desktop, 21px on narrow screens.
- Contribution line: 13px.
- Desktop retains a two-column layout; narrow screens use one column.
- Card padding and minimum height are reduced from 2.3.3 to avoid oversized cards while keeping the text comfortably readable.
- The HTML references `style.css?v=2.3.4` and `app.js?v=2.3.4`; the subtitle shows `UI 2.3.4` so the active frontend can be identified.

## Verification scope

The CSS selectors and requested font sizes were inspected in the source. Node syntax checks, available dependency-free tests, production source build, and ZIP integrity are reported separately in the verification report. Live browser rendering has not been independently captured in this environment.
