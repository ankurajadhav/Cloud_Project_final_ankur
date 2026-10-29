# Acceptance Checklist — Healthcare Fraud Intelligence 2.3.6

| Requirement | Status | Evidence |
|---|---|---|
| Provider deletion removes claims where `provider_id` or `referred_to` matches provider | **Verified** | API integration test deletes both categories and confirms records are absent. |
| Provider deletion removes referral events whose source or destination is the provider | **Verified** | Integration test deletes a manually created inbound referral and claim-linked events. |
| Referral events linked to cascaded claims are also removed | **Verified** | Transaction query includes `source_claim_id` referencing affected claims. |
| Child deletion is atomic with provider deletion, audit and analytics snapshot | **Verified by code and integration** | Shared `finishInputMutation` transaction rolls back writes on errors. |
| Each cascaded claim/referral receives an audit event | **Verified** | `DELETE_CASCADE` records are asserted in the integration workflow. |
| Claim audit payload redacts synthetic patient identifiers | **Verified** | Integration test asserts patient ID is absent from cascade audit JSON. |
| Providers with investigations are protected with no partial deletion | **Verified** | HTTP 409 test verifies associated claim and referral data remain. |
| Response and UI report deleted record counts | **Verified by source and integration** | API returns `deleted_claims` and `deleted_referrals`; frontend notification uses returned counts. |
| Analytics and summary are recalculated after cascade | **Verified** | Integration workflow checks provider, claim, and referral summary counts. |
| Automated test suite | **Verified** | 32/32 passed, including HTTP integration test. |
| TypeScript type-check | **Verified** | `npm run lint` passed. |
| Production source build | **Verified** | `npm run build` passed. |
| Fresh Windows `npm install` and browser click-through | **Not verified here** | Run these checks after extracting ZIP on Windows. |
| Real-world fraud detection validity | **Not established** | Synthetic demo data only; no adjudicated fraud labels. |
