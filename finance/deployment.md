# Finance — Deployment & Production Runbook

**Purpose**
Deployment, operational and security guidance for the Finance service. Finance runs in a high-trust environment and is responsible for the double-entry ledger, signed proofs, reconciliation tooling and auditor exports. This document covers topology, transport security (mTLS), KMS/HSM & signing proxy usage, DB encryption, backups/DR, CI guardrails, key rotation, observability, and incident runbooks.

**Audience:** SRE / Ops / Security / Finance Lead / Release Engineers

---

## 1 — High-level topology

```
API / Admin UI (Control-Panel) -> API Gateway -> Finance (service)
  ├─ Postgres (encrypted at rest, isolated network)
  ├─ Signing service (KMS/HSM or signing-proxy)
  ├─ Audit archive (S3 with Object Lock)
  ├─ Reconciliation service / batch export worker
  ├─ Observability (Prometheus/Grafana, tracing, Sentry)
  └─ Internal-only endpoints (reconcile, proofs, audit export)
Kernel (mTLS) -> Finance (for ledger proofs verification & audit subscription)
Marketplace -> Finance (settlement requests)
ArtifactPublisher -> Finance (proofs / payout)
```

**Principles**

* Finance must run in an **isolated, high-trust environment** with strict RBAC and audited operator actions.
* **KMS/HSM** or a vetted **signing-proxy** must sign ledger proofs and audit outputs — private keys must never be in code or repo. 
* All network traffic between Finance and Kernel/Marketplace/ArtifactPublisher should use **mTLS** or a trusted private network.

---

## 2 — Required environment variables (secrets via Vault / secret manager)

Do **not** commit secrets. Provide these from Vault or a similar secret manager:

Core:

* `NODE_ENV=production`
* `PORT`
* `DATABASE_URL` — Postgres with TLS; use DB user with least privilege
* `REQUIRE_KMS=true` or `REQUIRE_SIGNING_PROXY=true`
* `AUDIT_SIGNING_KMS_KEY_ID` (if using KMS)
* `AUDIT_SIGNING_ALG` (e.g., `rsa-sha256` or `hmac-sha256`)
* `SIGNING_PROXY_URL` and `SIGNING_PROXY_API_KEY` (if using signing proxy)
* `S3_AUDIT_BUCKET`, `S3_AUDIT_REGION`, `S3_AUDIT_ACCESS_KEY`, `S3_AUDIT_SECRET`
* `SENTRY_DSN`, `PROM_ENDPOINT`, `OTEL_COLLECTOR_URL`
* `KERNEL_API_URL` and `KERNEL_CLIENT_CERT`/`KERNEL_CLIENT_KEY` (if using mTLS) or `KERNEL_SERVICE_TOKEN`
* `FINANCE_ADMIN_TOKEN` — for internal tooling (rotate frequently)

**Production guards**

* `DEV_SKIP_MTLS=false` (must be false in production)
* `REQUIRE_KMS=true` or `REQUIRE_SIGNING_PROXY=true` — CI must enforce.

---

## 3 — Transport security (mTLS / tokens)

**Recommendation**

* Use **mTLS** for Finance ↔ Kernel, and Finance ↔ ArtifactPublisher/Marketplace if possible. mTLS ensures strong mutual authentication and is preferred. If mTLS is not feasible, use short-lived server tokens with tight rotation and restricted scope.

**Startup guard**

* Service should fail startup if `NODE_ENV=production` and `REQUIRE_KMS` or `REQUIRE_SIGNING_PROXY` is set but signing path is not configured. Finance now invokes `infra/startupGuards.ts` during boot, so setting these env vars in CI/staging also enforces the guard (no more silent fallbacks).

---

## 4 — Database & schema

**Postgres configuration**

* Use a dedicated Postgres cluster or instance for Finance with:

  * Encryption at rest (disk encryption)
  * TLS for client connections
  * PITR (WAL) enabled and regular backups
  * Minimum connection pool sizes and resource limits

**Schema & migrations**

* Use idempotent migrations and a migration runner in CI/CD. Migrations must be reviewed and applied via a controlled pipeline (no direct DB changes in prod).

**Least privilege**

* DB user used by Finance must have only necessary permissions (no superuser).

---

## 5 — Signing & KMS/HSM

**Requirement**

* **All signed ledger proofs and audit artifacts must be produced using KMS/HSM or a signing-proxy**. Do not store private keys in the repo or images. See agent-manager KMS examples for best practices (`MessageType:'DIGEST'` when signing precomputed digests). 

**Options**

* **Cloud KMS/HSM (recommended)**:

  * Use an asymmetric key (RSA_2048 / Ed25519). For RSA digest signing, set `MessageType: 'DIGEST'`.
  * IAM policy should be least-privilege: Finance service may call `Sign` and `GetPublicKey` only.
* **Signing Proxy**:

  * If using a signing-proxy, the proxy runs in high-trust, logs sign requests, and returns `{signature_b64, signer_id}`. Register `signer_id`/public key in Kernel verifier registry before trusting. 

**Operational**

* Publish public key to `kernel/tools/signers.json` with signer metadata prior to rotation. Maintain a key rotation plan and overlap verification window. 
* The canonical registry already contains `kernel-audit-ed25519-v1` and `kernel-audit-rsa-v1`. When Finance rotates its key, update that file (via `scripts/update-signers-from-kms.sh`) so Marketplace/Kernal/auditors verify proofs against the live public key set.

---

## 6 — Ledger proof format & signing semantics

**Proof contents**
A typical ledger proof should include:

* Range metadata (`from_ts`, `to_ts`, `ledger_row_ids`)
* Canonicalized hash of ledger range
* `signer_kid` and `signature` (base64)
* `ts` timestamp

**Signing guidelines**

* Compute digest as `SHA256(canonical(payload) || prevHashBytes)` if chaining. Use canonicalization helpers shared with Kernel. Ensure consistent canonical serialization for proof verification. Use KMS Sign with `MessageType: 'DIGEST'` for precomputed digests (RSA), or HMAC/KMS GenerateMac for HMAC keys. 

**Verification**

* Provide CLI `finance/tools/verify_proof.js` to validate a proof given a signer public key.

---

## 7 — Audit export & object-lock

**Export requirements**

* Finance must export ledger ranges and proofs to S3 audit archive with **Object Lock** enabled. Archives must be immutable and retained per legal policy.

**Export format**

* Use gzipped JSONL batches with metadata: `{ service: "finance", env, from_ts, to_ts, pii_included, pii_policy_version, signer_kid }`.

**Validation**

* Provide `finance/tools/auditReplay` and ensure `kernel/tools/audit-verify.js` (or similar) can verify chain integrity on exported batches. 

---

## 8 — Reconciliation & auditor exports

**Reconciliation**

* Implement `POST /reconcile` and `GET /reconcile/{id}/report` endpoints for automated reconciliation runs. The reconcile tool must compare Finance ledger with external payment provider reports and produce discrepancy reports.

**Auditor export**

* Provide auditor export endpoints and an offline export tool producing bundles consumable by auditors. Exports must include signed proofs for ledger ranges.

**DR**

* Reconstruct ledger state from audit exports and verify signatures; test this regularly.

---

## 9 — Backups & disaster recovery

**Backups**

* Daily backups of Postgres + WAL archiving. Test PITR regularly.
* Retain backups per policy and encrypt backups at rest.

**DR drill**

* Monthly DR drills: restore DB into a test cluster and run `finance/tools/generate_ledger_proof` + `audit-verify` to confirm proofs reproduce.

---

## 10 — Observability & SLOs

**Metrics**

* `finance.ledger_posts_total` (counter)
* `finance.ledger_post_latency_seconds` (histogram)
* `finance.proof_generation_duration_seconds` (histogram)
* `finance.reconciliation_discrepancies_total` (counter)
* `finance.audit_export_success_total` (counter)

**SLO examples**

* Proof generation p95 < 5s
* Ledger post success rate > 99.9%
* Reconciliation run time < operational SLA (define per deployment)

**Alerts**

* Proof generation failures, ledger imbalance detection, reconciliation discrepancies, KMS/signing errors.

**Tracing**

* Instrument proof generation and reconciliation flows; include trace IDs in audit payloads.

---

## 11 — CI & guardrails

**Mandatory CI checks**

* Unit tests and integration tests for ledger balancing and idempotency.
* E2E acceptance test: `checkout → ledger → proof` (mocked Marketplace or staging).
* Audit verification: `audit-verify` on sample ranges in CI or nightly.
* Secrets & key checks: `./scripts/ci/check-no-private-keys.sh` run on PRs.
* Protected branch check: For `main`/`release/*`, require `REQUIRE_KMS`/`REQUIRE_SIGNING_PROXY` secret and validate KMS/signing-proxy health in CI (similar to Kernel guard). 

---

## 12 — Key rotation & signer lifecycle

**Process**

1. **Create new key** in KMS or new signer in signing-proxy.
2. **Export public key** and add to Kernel verifier registry (`kernel/tools/signers.json`) with `deployedAt`. 
3. **Deploy Finance** referencing new signer key ID. Generate test proofs and run `audit-verify`.
4. **Monitor** and, after overlap period with successful verification, decommission old key from registry.

**Rollback**

* If new key produces verification failures, revert to previous key and investigate.

---

## 13 — Incident runbooks

### A. Ledger imbalance detected (critical)

**Symptoms:** automatic check detects that debits ≠ credits in posted transaction or reconciliation discrepancy.

**Immediate**

1. Halt new posting (set maintenance flag) to prevent further corruption.
2. Investigate the transaction(s): find offending journal rows and originating request.
3. If an in-flight process caused duplication, use idempotency keys to deduplicate; if schema-level issue, consult DB team.
4. Create remediation patch and plan (owner, ETA). Do not re-post broken transactions without thorough review.

**Post-incident**

* Rebuild ledger state from audit exports if needed. Run `audit-verify` to ensure chain integrity.

### B. Signing / KMS outage

**Symptoms:** Proof generation fails; KMS calls time out or signing proxy unreachable.

**Immediate**

1. Fail closed: stop producing signed proofs — do not produce unsigned ledger proofs for auditors.
2. Escalate to Security / KMS on-call. Check KMS console and quotas.
3. If emergency signing is approved by Security, follow emergency signer flow: generate temporary signer, publish public key to Kernel registry, and document audit justification. Re-issue proofs and rotate keys later. (Emergency signing is high-risk.) 

### C. Reconciliation discrepancy with Payment Provider

**Immediate**

1. Pause payouts related to discrepancy.
2. Collect payment provider reports and local ledger entries. Run reconciliation tool to produce discrepancy report.
3. Escalate to Finance Lead and Payment Provider support.

### D. Audit export failure or Object Lock misconfiguration

**Immediate**

1. Do not promote releases that require fresh audit exports until resolved (compliance block).
2. Fix S3 bucket policy or re-run export; use alternate archive bucket if necessary and remediate S3 object-lock settings.

---

## 14 — Example commands & diagnostics

```bash
# Run unit tests for ledger balancing
cd finance
npm ci && npm test

# Generate a ledger proof for a date range
cd finance/tools
./generate_ledger_proof.sh --from 2025-11-01 --to 2025-11-30 --out /tmp/ledger-proof.json

# Verify proof signature (example)
node finance/tools/verify_proof.js --proof /tmp/ledger-proof.json --public-key /tmp/signer.pub.pem

# Run audit-verify on local finance DB (uses kernel utility)
node kernel/tools/audit-verify.js -d "postgres://user:pw@localhost:5432/finance" -s kernel/tools/signers.json
```

---

## 15 — Final promotion checklist

* [ ] `REQUIRE_KMS=true` or `REQUIRE_SIGNING_PROXY=true` enforced and validated.
* [ ] KMS/HSM or signing-proxy reachable & healthy in production.
* [ ] Public key published to Kernel verifier registry prior to signer usage. 
* [ ] All unit/integration/e2e tests green in CI (ledger balance tests, proof generation tests).
* [ ] Audit export pipeline configured to S3 with Object Lock and tested.
* [ ] Reconciliation tooling present and DR drill completed.
* [ ] Metrics, alerts and dashboards configured and validated.
* [ ] Security Engineer and Finance Lead signoff recorded.

---

## 16 — References

* Kernel signer registry & audit-verify: `kernel/tools/signers.json`, `kernel/tools/audit-verify.js`.  
* KMS IAM & key rotation guidance: `docs/kms_iam_policy.md`, `docs/key_rotation.md`. 

---
