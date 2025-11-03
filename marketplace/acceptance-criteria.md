# Marketplace & Delivery — Acceptance Criteria

> **Scope:** Testable conditions required to accept the Marketplace & Delivery module. These checks are intended to be verifiable in staging (or prod-equivalent) and to produce auditable evidence.

## Final Acceptance Statement

Marketplace is accepted when every checklist item below is satisfied in the target environment, automated tests are green, audit integrity is verifiable, and formal written sign-off is recorded by Security Engineer, Finance Lead, and Ryan (SuperAdmin).

## Preconditions

- Kernel, KMS/Signing Proxy, and Audit Bus are available in the target environment.
- Finance endpoints for ledger and reconciliation are reachable.
- SentinelNet is available for synchronous policy checks.

## Acceptance Checklist (all must pass)

- [ ] **SKU catalog API implemented and searchable**
  - `GET /market/sku` returns seed SKUs and correctly respects filters (category, tag, price, owner).

- [ ] **End-to-end checkout flow**
  - `POST /market/purchase` creates an order with `pending` status.
  - Payment webhook (`POST /market/checkout/webhook`) confirms payment idempotently.
  - Finance reconciliation is performed and ledger entries are posted.
  - A signed license is issued and stored immutably.
  - Encrypted delivery artifact is produced and a time-limited download URL is returned.
  - All steps emit AuditEvents with verifiable hash and signature fields.

- [ ] **License verification**
  - `POST /market/license/{licenseId}/verify` validates signature and ownership for an issued license.

- [ ] **Preview & sandbox**
  - At least one preview type (`live|video|demo`) works in an isolated, time-limited sandbox with egress protections.

- [ ] **Royalties and settlement**
  - Royalty splits are computed per SKU metadata and Finance receives settlement requests correctly.

- [ ] **Refunds & chargebacks**
  - Refund flow revokes license access, posts correct reversal ledger entries, and emits audit events.

- [ ] **Policy enforcement**
  - SentinelNet blocks a policy-violating SKU or purchase in a simulated/canary test and records the `policyCheck` event with rationale.

- [ ] **Audit trail**
  - Orders → payments → license issuance → delivery produce a complete audit trail that passes head-hash verification.

## Objective Test Cases

1. **Catalog search:** Seed 10 SKUs; verify search results and filter behavior match expected fixtures.  
2. **Happy path purchase:** Run full flow and confirm order `paid`, Finance reconciliation, signed license verification, and valid download URL within TTL.  
3. **Webhook idempotency:** Send identical payment webhook twice; confirm single state transition and single ledger entry.  
4. **License verify after refund:** Verify license valid before refund, invalid after refund.  
5. **Sandbox isolation:** Start live preview; confirm egress blocked and auto-expiry.  
6. **Royalty calculation:** Validate payout batch for owner matches defined split rules.  
7. **Refund revocation:** Trigger refund and confirm license access revoked and ledger reversal recorded.  
8. **Policy block:** Attempt to purchase a flagged SKU and confirm rejection with `policyId` and audit evidence.  
9. **Audit verifier:** Run audit-verifier over purchase window; produce head-hash proof and pass spot-checks.

## Evidence to attach in final PR

- CI job links for unit, integration, and end-to-end tests.  
- Audit-verifier head-hash proof for a purchase window.  
- Finance reconciliation logs (non-PII).  
- Example signed license (redacted PII) and successful `verify` output.  
- Sandbox logs demonstrating isolation and expiry.  
- SentinelNet `policyCheck` log for a blocked purchase.

## Sign-offs (record as AuditEvents or PR approvals)

- Security Engineer: ☐  
- Finance Lead: ☐  
- Ryan (SuperAdmin): ☐

