# Finance — Acceptance Criteria (Final)

**Purpose:** concrete, testable acceptance gates proving Finance implements a double-entry ledger, invoice lifecycle, escrow/royalties, cryptographic ledger proofs, and secure production deployment. Each criterion below is actionable and includes the canonical file/command references where available. Final approver: **Ryan (SuperAdmin)**. Required reviewer: **Security Engineer** and **Finance Lead**. (See `finance/README.md`.) 

---

## Quick verification (how to run)

Run these locally or in CI against a test Finance DB and a mocked Marketplace:

```bash
# from repo root (or finance directory)
cd finance
npm ci            # or `go build` / `make build` depending on implementation
# Run unit tests
npm test
# Or run Go tests:
go test ./...     # for Go implementation
# Run acceptance e2e
# Example: run the checkout→ledger→proof e2e script if present
./run-local.sh    # spins local DB + signing proxy mock + runs e2e tests
```

---

## Files that must exist

A PR is incomplete if any required file is missing.

* `finance/acceptance-criteria.md` *(this file)*
* `finance/finance-spec.md` — core ledger model & flows (already expected)
* `finance/README.md` *(exists; staff reference)*. 
* `finance/api.md` — API surface (orders → journal entries → proofs)
* `finance/deployment.md` — topology (high-trust), DB encryption, signing proxy/KMS guidance (to be created)
* `finance/acceptance-tests/checkout-ledger.e2e.test.ts` — acceptance e2e that simulates checkout → ledger → proof → reconciliation
* `finance/test/unit/ledger_balance.test.*` — unit tests that assert double-entry balancing invariants
* `finance/tools/generate_ledger_proof.sh` or `finance/tools/generate_ledger_proof.go` — tool to produce signed proofs for ledger ranges (hash chain + signer metadata)
* `finance/docs/RECONCILIATION.md` — runbooks for reconciliation & auditor exports
* `finance/.github/workflows/finance-ci.yml` — CI workflow that runs unit + acceptance + audit verification
* `finance/infra/audit_export_policy.md` — instructions for S3 object-lock & export formatting

---

## Acceptance criteria (blocking items first)

### A. Core ledger invariants — Double-entry correctness (blocking)

**Acceptance**

* The ledger implements atomic double-entry posting: every journal entry must balance (debits == credits).
* Posting a transaction must create both journal rows and any related settlement rows in a single ACID transaction.
* Idempotency: re-sent settlement callbacks or retries must not create duplicate ledger entries.

**How to verify**

* Unit test `ledger_balance.test.*` constructs sample transactions and asserts balances and atomicity.
* Integration test: simulate a checkout that calls Finance; pause and retry the settlement callback; assert only one balanced journal entry exists.

**Commands**

```bash
# run unit tests that assert balancing
npm test -- test/unit/ledger_balance.test.*
# or for Go
go test ./finance/internal -run TestLedgerBalance
```

---

### B. Invoice lifecycle, escrow & payouts (blocking)

**Acceptance**

* Finance supports invoice creation, payment capture, escrow hold, release, and payout workflows.
* Escrow flows must ensure funds reserved are reflected in ledger reservations and reverted on failure.
* Royalties: compute and record royalty splits per SKU rules and persist distributions as ledger lines.

**How to verify**

* E2E test: create an order, simulate payment capture, assert ledger contains invoice, escrow reservation, debit/credit lines, and royalty splits.
* Payout test: simulate payout orchestration and confirm ledger entries (payout liability cleared, payout proof created).

---

### C. Cryptographic signed ledger proofs (blocking)

**Acceptance**

* Finance must produce signed ledger proofs for ranges (hash chain + signature) using KMS/HSM or signing proxy; proofs must include signer KID and timestamp and be verifiable by Kernel verifiers.
* No private keys in repository and KMS usage enforced in production.

**How to verify**

* Provide `finance/tools/generate_ledger_proof.*` that signs a range and outputs JSON: `{range:{from,to},hash,signer_kid,signature,ts}`.
* Unit test: verify proof verification routine using `kernel/tools/audit-verify.js` or a simple `crypto.verify` against exported public key.
* CI guard: require `REQUIRE_KMS=true` for protected branches or ensure signing proxy reachable.

**References**

* KMS IAM guidance and signer registry: see `docs/kms_iam_policy.md` and `kernel/tools/signers.json` examples.  

---

### D. API contract & idempotency (blocking)

**Acceptance**

* Finance API supports: `POST /ledger/post`, `GET /ledger/{id}`, `POST /invoices`, `POST /settlement`, `GET /proofs/range`, `POST /reconcile`.
* All write endpoints are idempotent (accept idempotency keys).
* Errors are consistent with the standard `{ ok: false, error: { code, message, details } }` contract.

**How to verify**

* Contract tests: call endpoints with idempotency keys and assert outcomes; call with duplicate idempotency key and assert idempotent behavior.

---

### E. Integration: Marketplace → Finance → ArtifactPublisher (blocking)

**Acceptance**

* Checkout flow: Marketplace calls Finance to create invoice and ledger entries; Finance returns a signed ledger proof that Marketplace/ArtifactPublisher uses to finalize delivery.
* Finalization must fail if Finance does not return a balanced and signed proof.

**How to verify**

* E2E acceptance test: `checkout-ledger.e2e.test.ts` simulates the full flow and validates that delivery only occurs after Finance proof and that ArtifactPublisher records `ledger_proof_id`.

---

### F. Audit & immutability (blocking)

**Acceptance**

* All ledger operations, invoices, payouts, and proofs must be audit-logged as append-only events with `hash`/`prevHash`/`signature`.
* Audit archive: Finance must export ledger and proofs to S3 with object-lock enabled for compliance.

**How to verify**

* Run `audit-verify` or equivalent on Finance audit rows (or exported batch) to ensure the chain verifies.
* Example:

```bash
node kernel/tools/audit-verify.js -d "postgres://user:pw@localhost:5432/finance" -s kernel/tools/signers.json
```

* Verify S3 export and object-lock metadata per `finance/infra/audit_export_policy.md`.

---

### G. Security & high-trust environment (blocking)

**Acceptance**

* Finance must run in an isolated high-trust environment with strict RBAC and mTLS for service calls.
* All signing of proofs must use KMS/HSM via a signing proxy; private keys never in code or repo.
* IAM least-privilege policy must be documented (`docs/kms_iam_policy.md`) and followed. 

**How to verify**

* Security review checklist in `finance/docs/prd-security.md`.
* CI guard that rejects PRs containing private key PEM or `.env` commits.

---

### H. Reconciliation & auditor exports (blocking)

**Acceptance**

* Provide a reconciliation endpoint and export format usable by auditors that includes ledger entries, proofs, and manifest linkages.
* Reconciliation tools must reconcile ledger state with external payment provider’s reports and produce discrepancy reports.

**How to verify**

* Run `finance/docs/RECONCILIATION.md` drill: export a reconciliation bundle, run reconciliation script, and assert results.

---

### I. Observability, metrics & alerts (P1)

**Acceptance**

* Metrics to expose:

  * `finance.ledger_posts_total`
  * `finance.ledger_post_latency_seconds`
  * `finance.proof_generation_duration_seconds`
  * `finance.reconciliation_discrepancies_total`
* Alerts on proof generation failures, ledger imbalance detection, and reconciliation discrepancies.

**How to verify**

* `/metrics` endpoint and unit smoke tests asserting metrics registration.

---

### J. Resilience & disaster recovery (P1)

**Acceptance**

* Finance must support DB backups, point-in-time recovery, and replay of audit-exported batches to reconstruct ledger state.
* The proof generation process must be deterministic and replayable from stored ledger rows.

**How to verify**

* Run DR drill: restore DB from backup into a test cluster, re-run proof generation for a range, and compare with archived proofs.

---

## Tests & automation (blocking)

* Unit tests for ledger balancing, idempotency, KMS adapter behavior.
* Integration tests for checkout→ledger→proof and reconciliation.
* E2E acceptance tests simulating marketplace interactions and final delivery gating.
* CI job `.github/workflows/finance-ci.yml` must run:

  * Unit tests
  * Integration acceptance tests (mock KMS/signing-proxy or require KMS in protected branches)
  * `audit-verify` on sampled audit rows.

---

## Documentation required (blocking)

* `finance/deployment.md` — high-trust topology, DB encryption at rest/in-transit, signing proxy / KMS details.
* `finance/api.md` — API contract with examples and error shapes.
* `finance/docs/RECONCILIATION.md` — auditor export format & reconciliation runbook.
* `finance/docs/prd-security.md` — PCI/financial controls and sign-off checklist.
* `finance/infra/audit_export_policy.md` — how to set up S3 object-lock and export jobs.

---

## Final acceptance checklist (copy into PR)

Mark items **PASS** only when tests pass and docs exist.

* [ ] Unit tests for ledger balancing and idempotency pass.
* [ ] E2E tests: checkout → ledger → proof → delivery pass.
* [ ] Signed ledger proof generation & verification (KMS or signing proxy) tested.
* [ ] Audit chain verified for sampled ranges (`audit-verify` passes).
* [ ] Reconciliation script & auditor export format validated (DR drill).
* [ ] Secrets and signing keys not in repo; KMS enforcement in CI.
* [ ] Observability metrics and alerts configured.
* [ ] Security Engineer and Finance Lead signoff recorded (`finance/signoffs/security_engineer.sig`, `finance/signoffs/finance_lead.sig`).
* [ ] Final sign-off: **Ryan (SuperAdmin)**.

---

## Minimal reviewer commands

```bash
# run unit tests
cd finance
npm ci && npm test

# run acceptance e2e (local)
./run-local.sh

# generate a ledger proof for range and verify
cd finance/tools
./generate_ledger_proof.sh --from 2025-01-01 --to 2025-01-31
# verify using kernel verifier or openssl + public key
```

---

## References & notes

* Finance must integrate with Kernel signing and audit model; ensure public keys are registered in Kernel’s verifier registry. See `kernel/tools/signers.json` example & KMS IAM guidance.  
* Deployment must enforce a high-trust environment for Finance (KMS/HSM usage and mTLS).

---

