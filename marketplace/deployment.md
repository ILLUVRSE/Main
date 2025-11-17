# Marketplace — Deployment & Production Runbook

**Purpose**
Deployment, operational, and security guidance for Marketplace in production. Covers topology (CDN, Delivery, S3/object-lock audit archive), delivery key management and encrypted delivery, KMS/HSM signing, preview sandbox controls, CI guardrails, key rotation, monitoring/SLOs and DR. Follow these steps exactly for production promotion.

**Audience:** SRE / Ops / Security / Release Engineers / Product

---

## 1 — High-level topology

```
Clients (browser / control-panel) -> CDN/WAF -> Marketplace API (Next.js/Express / backend services)
  ├─ ArtifactPublisher (or callout) -> handles delivery, signed proofs, multisig flows
  ├─ Kernel (mTLS, RBAC) -> manifest verification + audit ingestion
  ├─ Finance (ledger + proof) -> settlement & signed ledger proofs
  ├─ Signing service (KMS/HSM or signing-proxy)
  ├─ Preview sandbox pool (isolated execution nodes / container pool)
  ├─ S3 (artifact store + audit-archive with Object Lock)
  └─ Observability (Prometheus, Grafana, Tracing, Sentry)
```

Key principles:

* All signing for audit or proofs must be done with KMS/HSM or an audited signing proxy (no private keys in code). See KMS IAM guidance. 
* Kernel-signed manifest validation is required before listing or delivery; Marketplace must call Kernel server-side (mTLS or server token).
* Audit exports must be written to S3 with Object Lock enabled for compliance. Use ArtifactPublisher or Marketplace to record `manifestSignatureId` and `ledger_proof_id`.

---

## 2 — Required environment variables

Place secrets in Vault / Secret Manager; do **not** commit.

Core:

* `NODE_ENV=production`
* `PORT`
* `DATABASE_URL`
* `S3_ENDPOINT`, `S3_BUCKET`, `S3_AUDIT_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
* `CDN_ORIGIN` / `CDN_URL`
* `KERNEL_API_URL`, `KERNEL_CONTROL_PANEL_TOKEN` or `KERNEL_CLIENT_CERT`/`KERNEL_CLIENT_KEY` (mTLS)
* `SIGNING_PROXY_URL` and `SIGNING_PROXY_API_KEY` or `AUDIT_SIGNING_KMS_KEY_ID` & `AUDIT_SIGNING_ALG` (KMS)
* `FINANCE_API_URL` and `FINANCE_SERVICE_TOKEN`
* `PAYMENT_PROVIDER_*` (kept minimal, e.g., webhook secret; card data never stored)
* `PREVIEW_SANDBOX_POOL_CONFIG` (pool size, resource limits)
* `PROM_ENDPOINT`, `SENTRY_DSN`, `OTEL_COLLECTOR_URL`

Production Guards:

* `REQUIRE_SIGNING_PROXY=true` or `REQUIRE_KMS=true`
* `DEV_SKIP_MTLS=false` (must be false in production)

---

## 3 — CDN, WAF & edge configuration

* Put the Marketplace behind a CDN + WAF (CloudFront/Cloudflare). Terminate TLS at the edge; ensure:

  * Edge-to-origin uses TLS. Prefer mTLS if supported by your origin.
  * Enforce CSP, HSTS, and secure cookies.
  * Enable edge caching for catalog endpoints with short TTLs. Do **not** cache private buyer endpoints.

Edge rules:

* Block requests that attempt to probe signing endpoints.
* Rate-limit public-facing endpoints and webhooks.

---

## 4 — S3 & Audit Archive (Object Lock)

**Audit archive**:

* Use a dedicated S3 bucket for audit exports: `s3://illuvrse-audit-archive-${ENV}`. Enable **Object Lock** with governance/compliance mode as required by legal. Export naming convention: `reasoning-graph|marketplace/yyyy-mm-dd/<batch>.jsonl.gz`.
* Exports must include metadata: `{service, env, version, pii_included, pii_policy_version, export_ts}`.

**Access controls**:

* Restrict access to the audit bucket to auditor roles only via IAM (least privilege). Use separate credentials for export jobs.

**Verification**:

* Include a CI step or cron job that downloads a sample export and runs `kernel/tools/audit-verify.js`. See audit-verify utility for format expectations. 

---

## 5 — Delivery & Encryption (Buyer Keys / HSM)

Marketplace/ArtifactPublisher must support encrypted delivery. Options:

### Option A — Buyer-managed keys (recommended for privacy)

1. Generate ephemeral RSA/Ed25519 keypair client-side or via buyer-managed KMS.
2. Marketplace encrypts the delivery artifact with buyer public key and stores encrypted object in S3 (or delivers via short-lived pre-signed URL).
3. Record key provenance and `manifestSignatureId` in delivery AuditEvent.

### Option B — Marketplace-managed ephemeral keys via HSM/KMS

1. Marketplace requests short-lived ephemeral key from HSM/KMS (or signing proxy) bound to the order.
2. Use ephemeral key to encrypt artifact; publish proof linking ephemeral key id and audit event.
3. Rotate ephemeral keys aggressively; record origin in audit.

**Key provenance** and `manifestSignatureId` + `ledger_proof_id` must be included in signed proof.

**S3 delivery policy**:

* Encrypted delivery artifacts may be placed in a separate delivery bucket with tight lifecycle and pre-signed URL expiry (e.g., 1–24 hours).
* Audit-proof must be immutable and exported to audit archive after delivery.

---

## 6 — KMS / Signing Proxy & IAM

**KMS usage**

* Use asymmetric KMS keys for signing proofs and audit outputs. When using AWS KMS make sure to call Sign with `MessageType: 'DIGEST'` for precomputed digests (see agent-manager signAuditHash). See KMS IAM minimal policy in docs.  

**Signing proxy**

* Organizations using a signing-proxy must ensure:

  * Proxy exposes health and signing endpoints, and logs every signing request with timestamps and caller identity.
  * Proxy rotates API keys and provides signer KIDs for registration into `kernel/tools/signers.json`.

**Register public keys**

* Export public keys and publish to Kernel verifier registry before swapping signers (see key rotation section). Example helper and format: `kernel/tools/signers.json`. 

**CI guard**

* CI must enforce `REQUIRE_SIGNING_PROXY` or `REQUIRE_KMS` for merges to `main` and refuse to proceed if signing endpoint unreachable.

---

## 7 — Preview sandbox infrastructure

**Architecture**

* Dedicated sandbox pool of short-lived containers (K8s pods) with strict CPU / memory cgroups, seccomp, AppArmor, and network egress controls (deny by default).
* Sandbox runner submits deterministic workloads, enforces TTL, collects logs, and emits AuditEvents (`preview.started`, `preview.exited`, `preview.expired`).

**Security**

* Sandbox must run as non-root and must not have access to secrets or production networks. Provide NAT rules or stubbed endpoints for outbound calls.
* Monitor sandbox resource usage; auto-reap hung sessions.

**Observability**

* Collect sandbox metrics: session_count, session_duration_histogram, sandbox_failures_total, audit_write_failures_total.

**Testing**

* Provide `marketplace/test/unit/sandboxRunner.test.ts` for determinism and enforce limits.

---

## 8 — CI / release process & guardrails

**CI jobs to include**

* Unit tests (catalog, manifest validation, signing adapter mocks).
* Contract tests (`marketplace/api.md`) for public endpoints.
* E2E acceptance tests (`checkout.e2e`, `signedProofs.e2e`) in an isolated runner that brings up Kernel/Finance mocks (or uses dedicated staging).
* Audit verification step: run `kernel/tools/audit-verify.js` on a sampled audit export. 

**Release gating**

* For protected branches or `main`, require `REQUIRE_SIGNING_PROXY=true` or `REQUIRE_KMS=true`. CI must check that signing path is reachable (`kernel/ci/require_kms_check.sh` pattern). 

**Example workflows**

* `.github/workflows/marketplace-ci.yml` — unit/test/build/e2e/audit-verify. Configure secrets for staging jobs only.

---

## 9 — Key rotation & signer lifecycle

**High-level steps**

1. **Create** new KMS key or new signing-proxy signer with unique `signerId`.
2. **Export public key** and add it to `kernel/tools/signers.json` with `deployedAt` timestamp **before** using key. 
3. **Deploy** Marketplace referencing new signer or KMS key. Run smoke tests and `audit-verify` across test snapshots.
4. **Monitor** logs for signature verification failures; after verification period, remove old signer from registry.

**Rollback**

* If proof verification fails after rotation, revert to previous code/config and re-enable old signer. Do not disable old signer in registry until new signing verified across production verifiers.

---

## 10 — Monitoring, SLOs & alerts

**Key SLOs**

* Checkout flow: 95th percentile latency < 500ms (api-level for checkout create).
* Finalization workflow (payment->finalize): median < 2s, p95 < 10s (depending on Finance latency).
* Delivery encryption failures < 0.1% of orders.

**Metrics**

* `marketplace.orders_total`, `marketplace.checkout_latency_seconds`, `marketplace.delivery_encrypt_failures_total`, `marketplace.royalty_payouts_total`, `marketplace.audit_export_success_total`.

**Alerts**

* High delivery failure rate, proof generation failures, KMS errors, audit export failures, unauthorized manifest acceptance attempts.

**Dashboards**

* Order flow funnel, delivery success trend, audit export status, KMS/signing error rates.

---

## 11 — Backups, DR & audit replay

**Backups**

* DB backups: daily snapshots + PITR (WAL).
* S3 audit exports: retained and immutable via object-lock.

**DR drill**

* Restore DB into test cluster monthly; run `audit-verify` on a known range and run a sample playback to re-generate delivery proofs.

**Audit replay**

* Implement `marketplace/tools/auditReplay` to rebuild delivery state and verify signed proofs against public keys.

---

## 12 — Example commands & validation

**Export public key for Kernel signer registry**

```bash
# Example (AWS KMS)
AUDIT_KEY_ARN="arn:aws:kms:us-east-1:123456789012:key/abcd"
aws kms get-public-key --key-id "$AUDIT_KEY_ARN" --query PublicKey --output text | base64 --decode > /tmp/audit_key.der
openssl rsa -pubin -inform DER -in /tmp/audit_key.der -pubout -out /tmp/audit_key.pem
cat /tmp/audit_key.pem
```

Publish to `kernel/tools/signers.json` in the `signers` list and commit after review. 

**Verify signed proof (example using OpenSSL for RSA)**

```bash
# Given proof.json contains canonical payload and signature base64
jq -r '.signature' proof.json | base64 --decode > /tmp/sig.bin
jq -r '.canonical_payload' proof.json > /tmp/payload.json
openssl dgst -sha256 -verify /tmp/audit_key.pem -signature /tmp/sig.bin /tmp/payload.json
```

**Run audit-verify on local DB**

```bash
node kernel/tools/audit-verify.js -d "postgres://postgres:postgres@localhost:5432/marketplace" -s kernel/tools/signers.json
```

(Useful for acceptance and DR checks.) 

---

## 13 — Promotion checklist (pre-prod release)

* [ ] `REQUIRE_SIGNING_PROXY` or `REQUIRE_KMS` set and validated in CI.
* [ ] KMS key / signing-proxy configured and public key published to Kernel verifier registry. 
* [ ] CDN & WAF configured; origin TLS enforced.
* [ ] S3 audit archive with Object Lock configured and tested.
* [ ] Preview sandbox pool hardened (seccomp/AppArmor, network egress controls).
* [ ] Playwright e2e tests (checkout/finalize/signedProofs) pass in CI.
* [ ] Monitoring dashboards & alerts in place.
* [ ] DR drill completed (sample restore + audit-verify).
* [ ] Security review completed and sign-off present.

---

## 14 — Incident procedures

* **Signing failure / KMS down**: fail closed (do not finalize orders requiring signed proofs). Engage Security & KMS on-call. Consider emergency signing only with Security-approved temporary signer and follow key rotation process.
* **Audit export failure**: fail closed for final promotion; retry export with backoff and notify on-call.
* **Preview sandbox breakout**: immediately isolate pool, revoke network routes, and rotate sandbox image.

---

## 15 — References

* Kernel audit & signer examples: `kernel/tools/signers.json`, `kernel/tools/audit-verify.js`.  
* KMS IAM policy & key rotation guidance: `docs/kms_iam_policy.md`, `docs/key_rotation.md`. 

---
