# Acceptance Checklist — Healthcare Fraud Intelligence 2.3.8

| Requirement | Status | Evidence |
|---|---|---|
| Whole network shows every current provider, including isolated nodes | **Verified by API/source** | Graph includes all provider rows; default filter is Whole network. |
| Node labels include provider IDs and useful names | **Verified by source and syntax check** | SVG displays ID and shortened name; title includes full provider details. |
| Edge direction is visually explicit | **Verified by source and API integration** | Directed path ends with arrow marker; edge endpoints match `from_provider` and `to_provider`. |
| Only unique directed provider dependencies are drawn | **Verified** | Analytics builds unique graph topology; `event_count` indicates repeated event records. |
| Reciprocal dependencies are visually distinguishable | **Implemented; browser visual review pending** | Opposite directions use opposite curve offsets. |
| Ring/SCC clusters are clearly distinguished from smaller cycles | **Implemented; browser visual review pending** | Reportable 3+ cycles use purple component clusters; smaller cycles use amber styling. |
| Search highlights matching provider and connected edges | **Verified by source and JavaScript syntax** | Search on ID/name/specialty dims unrelated nodes and edges. |
| Whole network, reportable rings, and all cycles filters work | **Verified by source and JavaScript syntax** | State-backed select rebuilds the filtered graph; empty-filter state can return to Whole network. |
| Wheel zoom, pointer pan, reset and keyboard node selection remain available | **Verified by source and JavaScript syntax** | Existing controls retained in the rewritten graph renderer. |
| New providers appear in the graph immediately after mutation | **Verified** | SQLite API integration asserts graph includes newly created provider. |
| New claims with referral recipients update current edges | **Verified** | Integration checks both recipient edges after claim creation. |
| Completing a real 3+ provider cycle updates ring membership | **Verified** | Integration adds a cycle-closing referral and checks the new provider is in `analytics.rings`. |
| Removing the cycle-closing edge updates ring membership | **Verified** | Integration removes the edge and asserts the provider is no longer in a reportable ring. |
| Dashboard ring panels show data version and calculation timestamp | **Implemented; browser visual review pending** | `renderRings` and `renderGraph` display live snapshot metadata. |
| API responses cannot be served from a browser cache | **Verified** | `no-store` response headers are asserted; frontend fetch specifies `cache: 'no-store'`. |
| Parallel dashboard reads are checked for version consistency | **Verified by source and API version tests** | Header/data versions are compared; loading retries on mismatch. |
| Summary and graph expose matching analytical versions | **Verified** | Integration asserts graph and summary data versions match after data changes. |
| Full automated test suite | **Verified** | 32/32 tests passed. |
| TypeScript check and production build | **Verified** | `npm run lint` and `npm run build` passed. |
| Live browser visual review on Windows | **Not independently verified** | Headless Chromium could not complete a screenshot in this environment; inspect after extracting the ZIP on Windows. |
| Fresh Windows dependency installation | **Not independently verified** | Run `npm install` on the target Windows machine. |
| Real-world fraud-detection accuracy | **Not established** | Dataset is synthetic and contains no independently adjudicated fraud labels. |
