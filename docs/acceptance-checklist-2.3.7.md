# Acceptance Checklist — Healthcare Fraud Intelligence 2.3.7

| Requirement | Status | Evidence |
|---|---|---|
| Edit Claim form shows the claim's currently linked referral recipients | **Verified by source and API integration** | Recipients are loaded from current referral events using `source_claim_id`. |
| Add multiple new recipients while editing a claim | **Verified** | Integration test adds P003 while keeping P001. |
| Remove deselected recipients while editing | **Verified** | Integration test removes the claim-linked P002 event. |
| Existing selected recipients are preserved | **Verified** | Integration test keeps P001 linked. |
| Standalone/manual referral events are not changed | **Verified** | An event with `source_claim_id = NULL` remains after linked recipients are reconciled. |
| Legacy clients omitting `referral_targets` do not change recipients | **Verified** | API patch test confirms two linked events remain when only amount is edited. |
| Duplicate, self, unknown, inactive-new recipient validation | **Verified by source; duplicate edit case tested** | Validation runs server-side; currently linked inactive recipients can be retained/removed. |
| Claim and linked-referral changes are transactional | **Verified by code path and integration workflow** | Uses `finishInputMutation`; analytics failures roll back. |
| New/removed referral events are audited | **Verified** | `CREATE_FROM_CLAIM_EDIT` and `REMOVE_FROM_CLAIM` audit operations asserted. |
| Graph uses unique directed dependencies and aggregated event counts | **Verified** | Integration test checks edge count and per-edge event count after reconciliation. |
| TypeScript and production build | **Verified** | `npm run lint`, `npm run build` passed. |
| Full automated suite | **Verified** | 32/32 passed. |
| Fresh Windows install and live browser click-through | **Not independently verified** | Run after extraction on Windows; confirm subtitle says `UI 2.3.7`. |
| Real-world fraud detection validity | **Not established** | Synthetic dataset only; no independently adjudicated fraud outcomes. |
