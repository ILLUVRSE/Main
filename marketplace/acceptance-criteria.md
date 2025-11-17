# Marketplace — Acceptance Criteria (Final)

**Purpose:** concrete, testable acceptance gates to prove the Marketplace implements secure, auditable, and production-ready listing, preview, checkout, license issuance, encrypted delivery, and finance settlement. Each item below is a verifiable test or artifact. Final approver: **Ryan (SuperAdmin)**. Security & Finance must sign off on payment and settlement integrations. (See `marketplace/README.md`.) 

---

## How to run verification (quick)

Run these locally or in CI against a test Kernel and Finance service (or their well-documented mocks).

```bash
# 1) install & build (from repo root)
cd marketplace
npm ci
npm run build

# 2) run local orchestration if provided (or start mocks for Kernel/Finance)
# Example: ./run-local.sh - spins up local Kernel mock, test DB, S3 dev, and server

# 3) run E2E tests
npx vitest run test/e2e/checkout.e2e.test.ts
# or run the full acceptance e2e suite
npx vitest run test/e2e --runInBand
```

All commands above should succeed in CI or local staging.

---

## Files that must exist

Ensure the following files are present (missing file = PR incomplete):

* `marketplace/acceptance-criteria.md` *(this file)*
* `marketplace/README.md` *(exists; quick reference)*. 
* `marketplace/marketplace-spec.md` *(core spec)*
* `marketplace/api.md` — API surface & examples for listing, preview sandbox, checkout, license verification (to be created if absent)
* `marketplace/deployment.md` — CDN, delivery key management, S3 policies, preview sandbox network controls (to be created if absent)
* `marketplace/test/e2e/checkout.e2e.test.ts` — deterministic checkout → payment → ledger → delivery E2E test
* `marketplace/test/e2e/signedProofs.e2e.test.ts` — signed proof generation + verification test
* `marketplace/test/unit/sandboxRunner.test.ts` — preview sandbox determinism unit test
* `marketplace/run-local.sh` (or equivalent) — local orchestration for dev/test including S3/minio and Kernel/Finance mocks
* `.github/workflows/marketplace-ci.yml` — CI workflow to run unit + e2e suites
* `marketplace/docs/PRODUCTION.md` — runbook & production controls
* `marketplace/docs/prd-security.md` — security checklist with PCI/DRM notes

If any are missing, add them or the PR does not pass acceptance.

---

## Acceptance criteria (blocking items first)

### A. Core API & contract (blocking)

**Acceptance**

* Implement APIs for:

  * `GET /catalog` — lists SKUs with signed manifest verification.
  * `GET /sku/{id}` — SKU details & preview metadata.
  * `POST /sku/{id}/preview` — create a preview sandbox session (time-limited, auditable).
  * `POST /checkout` — create an order, call Finance, and return order status.
  * `GET /order/{id}/license` — fetch issued license & signed proof.
  * `POST /license/verify` — verifies license signatures, proof, and ownership.
* API shapes and error formats documented in `marketplace/api.md` and enforced by a validator in CI.

**How to verify**

* Contract tests (unit/integration) assert HTTP shapes and `ok:true` semantics.
* Example command:

  ```bash
  npx vitest run test/contract/ --runInBand
  ```

---

### B. Preview sandbox & security (blocking)

**Acceptance**

* Preview sandboxes must:

  * Be time-limited (TTL), isolated, and auditable.
  * Enforce CPU/memory/timebox and network constraints.
  * Expose limited, deterministic preview capabilities (no persistent keys or secrets leaked).
* Sandbox runs must be recorded as AuditEvents linking the preview session to the SKU manifest.

**How to verify**

* Unit/integration test runs sandbox commands and asserts `passed|failed|timeout` semantics and that `audit_events` were recorded.
* Play an end-to-end preview: `POST /sku/{id}/preview` → get `session_id` → connect to preview → ensure logs & audit recorded.

---

### C. Kernel-signed manifest validation (blocking)

**Acceptance**

* Marketplace must validate Kernel-signed manifests (signature + signer id + manifest fingerprint) before listing or delivering a SKU.
* All manifest validations must be logged and produce AuditEvents.

**How to verify**

* Provide sample signed manifest (or Kernel mock) and run listing flow; test that an invalid or altered manifest is rejected.
* Unit test: `npx vitest run test/unit/manifestValidation.test.ts`.

---

### D. Checkout → Finance → ledger & settlement (blocking)

**Acceptance**

* Checkout flow must:

  1. Reserve SKU and create pending order.
  2. Call Payment Provider (Stripe or mock) securely (PCI compliance: do not store card data).
  3. On successful payment, call Finance to create balanced ledger entries and return a signed ledger proof.
  4. On settlement, ArtifactPublisher or Marketplace produces an encrypted delivery and signed proof referencing the Kernel manifest and ledger entry.
* Marketplace must reject finalization if Finance does not return balanced ledger entries.

**How to verify**

* Run deterministic e2e: `checkout.e2e.test.ts` that simulates payment (mock) and asserts that Finance ledger entries are balanced and signed. Confirm the delivered artifact includes `manifestSignatureId` and ledger proof.

---

### E. Signed delivery & license issuance (blocking)

**Acceptance**

* Delivery artifacts must be encrypted to the buyer (short-lived keys or buyer-managed keys).
* A signed proof (artifact SHA-256 + Kernel signature + finance ledger entry) must be produced for every completed order.
* License issuance must produce a cryptographically signed license document linked to SKU + buyer + order id.

**How to verify**

* `signedProofs.e2e.test.ts` must verify:

  * Encrypted delivery decrypts with buyer key.
  * Signed proof includes correct hash, manifestSignatureId, and finance ledger id and verifies against Kernel verifier or signing proxy.

---

### F. Royalties & payout flows (blocking for finance sign-off)

**Acceptance**

* Marketplace computes royalties and integrates with Finance to record royalty splits and payouts.
* Royalties must be auditable and appear on ledger entries with a breakdown.

**How to verify**

* Test case creating a multi-rights SKU with royalty rule; run checkout with a settlement, assert ledger entries include royalty splits and payout schedules; Finance confirms state.

---

### G. Auditability & immutability (blocking)

**Acceptance**

* All order, payment, license, delivery and transfer events must be emitted as AuditEvents with `hash`, `prevHash`, `signature` fields and must reference the Kernel-signed manifest where appropriate.
* Audit events must be exportable to an append-only store (S3 with object-lock) and verifiable by `kernel/tools/audit-verify.js`.

**How to verify**

* Run `audit-verify` against sampled audit rows or exported archives and assert chain integrity.
* Example:

  ```bash
  node kernel/tools/audit-verify.js -d "postgres://user:pw@localhost:5432/marketplace" -s kernel/tools/signers.json
  ```

---

### H. Security & compliance (blocking)

**Acceptance**

* PCI compliance: Marketplace must not store raw card data; integrate with PCI-compliant payment provider (Stripe).
* KMS/HSM for signing proofs; no private keys in repo. `REQUIRE_KMS` enforced for protected branches.
* mTLS for service-to-service where required (Kernel, Finance, Signing Proxy).

**How to verify**

* Security review checklist: `marketplace/docs/prd-security.md` must be completed and passed.
* CI: `./scripts/ci/check-no-private-keys.sh` job must run on PRs.

---

### I. Observability & metrics (P1)

**Acceptance**

* Metrics to expose: `marketplace.orders_total`, `marketplace.checkout_latency_seconds`, `marketplace.delivery_encrypt_failures_total`, `marketplace.royalty_payouts_total`.
* Logs must not include secrets and must include `request_id` and `order_id` for traceability.

**How to verify**

* `/metrics` endpoint returns histogram & counters; test via unit smoke test.
* Ensure tracing injects `traceId` into audit payloads.

---

### J. Resilience & replay (P1)

**Acceptance**

* Delivery, license issuance, and audit writes must be idempotent.
* Ability to replay and reconcile orders/deliveries from audit logs and S3 archives.

**How to verify**

* Simulate duplicate webhook retries and confirm idempotency.
* Run audit replay tool (if present) to regenerate deliveries from archived artifacts and verify idempotent behavior.

---

## Tests & automation (blocking)

* **Unit tests** for manifest validation, sandbox runner, license verification.
* **E2E tests**:

  * `test/e2e/checkout.e2e.test.ts` — deterministic checkout → payment → finance → proof → license → delivery.
  * `test/e2e/signedProofs.e2e.test.ts` — verifies signed proofs + audit verification.
  * `test/e2e/multisig-e2e.test.ts` — multisig upgrade/flow with Kernel mock for multisig gating where applicable.
* **CI**: `.github/workflows/marketplace-ci.yml` must run unit + e2e suites and the audit verification step.

---

## Documentation required (blocking)

* `marketplace/api.md` — full API contracts with examples.
* `marketplace/deployment.md` — CDN, S3 object-lock policies for audit archives, delivery key rotation, and preview sandbox network controls.
* `marketplace/docs/PRODUCTION.md` — runbook + playbooks for incident response (delivery failure, finance reconciliation errors).

---

## Final acceptance checklist (copy into PR)

Mark items **PASS** only when tests pass and docs exist.

* [ ] `marketplace/README.md` up-to-date. 
* [ ] `marketplace/api.md` present and contract tests green.
* [ ] `marketplace/deployment.md` present and reviewed by Security/Ops.
* [ ] Preview sandbox deterministic unit test passes.
* [ ] Checkout e2e passes (checkout → payment → finance → signed proof → delivery).
* [ ] Signed proof verification test passes.
* [ ] Royalty and payout test cases pass and reconcile with Finance.
* [ ] All critical flows emit AuditEvents; audit chain verified.
* [ ] No private keys in repo; KMS/signing proxy enforced in CI for protected branches.
* [ ] Observability metrics & alerts present and validated.
* [ ] Security Engineer & Finance Lead reviewed and signed off (add `marketplace/signoffs/security_engineer.sig` and `marketplace/signoffs/finance_lead.sig`).
* [ ] Final sign-off: **Ryan (SuperAdmin)**.

---

## Minimal commands for reviewers (copy/paste)

```bash
# run unit tests
cd marketplace
npm ci
npm test

# run e2e (deterministic)
npx vitest run test/e2e/checkout.e2e.test.ts --runInBand

# verify audit chain (if using local DB)
node ../kernel/tools/audit-verify.js -d "postgres://postgres:postgres@localhost:5432/marketplace" -s ../kernel/tools/signers.json
```
---
