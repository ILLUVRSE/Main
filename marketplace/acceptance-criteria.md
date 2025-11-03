```markdown
# Marketplace & Delivery — Acceptance Criteria

> **Scope**: This file defines the testable conditions required to accept the **Marketplace & Delivery** module. It mirrors the acceptance section in `marketplace-spec.md` and converts it into a checklist with verifiable artifacts.

---

## Final Acceptance Statement
Marketplace is accepted when the criteria below are satisfied in staging (or prod-equivalent), automated tests are green, audit integrity is verifiable, and formal sign‑off is recorded by **Security Engineer**, **Finance Lead**, and **Ryan (SuperAdmin)**.

---

## Preconditions
- Kernel, KMS/Signing Proxy, and Audit Bus are live in the target environment.
- Finance service endpoints for ledger/reconciliation are reachable.
- SentinelNet is available for synchronous policy checks.

---

## Acceptance Checklist (must all pass)
- [ ] **SKU catalog API** implemented and searchable (`GET /market/sku`, filters by category/tag/price/owner return expected results over seed data).
- [ ] **End-to-end checkout** works:
  - [ ] `POST /market/purchase` creates `orderId` with `pending` status.
  - [ ] Payment processor **webhook** (`POST /market/checkout/webhook`) confirms payment (idempotent; duplicate webhook does not double-confirm).
  - [ ] **Finance reconciliation** called; ledger entries posted and confirmed.
  - [ ] **License issuance** performed (signed license, immutable record saved).
  - [ ] **Encrypted delivery** artifact created and time-limited **download URL** returned.
  - [ ] All steps emit **AuditEvents** with verifiable hash/signature chain.
- [ ] **License verification** endpoint (`POST /market/license/{licenseId}/verify`) validates signature & ownership for a known license.
- [ ] **Preview & sandbox** flow works with isolation and automatic expiration for at least one preview type (`live|video|demo`).
- [ ] **Royalties & splits** are calculated correctly; **Finance** receives settlement requests and produces confirmation.
- [ ] **Refund/chargeback** path revokes license access and posts correct reversal entries to Finance; audit events are complete.
- [ ] **SentinelNet** blocks a policy-violating SKU or purchase in a simulation/canary test and records the decision (policy id + rationale).
- [ ] **Audit trail** for orders → payments → licenses → deliveries is complete and passes head-hash verification with the audit verifier.

---

## Objective Test Cases
1. **Catalog search:** Seed 10 SKUs; query with tag & price filters; response set matches seed fixtures.
2. **Happy path purchase:** Execute full flow; verify: order status `paid`, Finance reconciliation receipt, issued license signature verifies, delivery URL valid within TTL, and all expected AuditEvents present.
3. **Webhook idempotency:** Send the same payment webhook twice; order state remains `paid` (no duplicate effects), single Finance reconciliation.
4. **License verify:** Call verify for issued license → `valid=true`; call verify after refund → `valid=false`.
5. **Sandbox preview:** Start preview; ensure isolation (egress restricted), auto-expire after configured TTL.
6. **Royalty split:** Create payout batch for owner; Finance reflects expected split percentages.
7. **Refund:** Trigger refund; license revoked, ledger reversal posted, download URL invalidated.
8. **Policy block:** Attempt purchase of flagged SKU; SentinelNet returns `deny` and Marketplace blocks order.
9. **Audit proof:** Run audit verifier over the date range; proof includes head-hash and count; spot-check passes.

---

## Evidence to Attach in Final PR
- Links to **CI jobs** for unit/integration/e2e tests.
- Audit verifier **head-hash proof** for a purchase window.
- **Finance reconciliation** logs/receipts (non-PII).
- **Signed license** sample (redacted buyer fields) + successful `verify` response.
- **Preview sandbox** logs showing isolation and auto-expiration.
- **SentinelNet** decision log for a blocked purchase.

---

## Sign-offs (recorded as AuditEvents or PR approvals)
- Security Engineer: ☐  
- Finance Lead: ☐  
- Ryan (SuperAdmin): ☐
```

