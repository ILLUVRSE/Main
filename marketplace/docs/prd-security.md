# Marketplace — Production Security & Compliance (PCI / DRM / Signing)

**Purpose**
Security & compliance requirements, controls, and verification tasks for the Marketplace service in production. Covers payment provider / PCI controls, DRM and encrypted delivery, signing/KMS usage, secret management, CI guardrails, and audit controls. Final sign-off required from Security Engineer and Finance Lead.

**Audience:** Security Engineer, SRE, Finance Lead, Devs

---

## 1 — Summary / Objectives

* Ensure all payment flows are PCI-compliant: Marketplace must never store raw card data and must validate webhooks securely.
* Ensure every delivery, license and ledger proof is cryptographically signed using KMS/HSM or signing-proxy; no private keys in source control.
* Enforce least privilege and mTLS for service-to-service communication (Kernel, Finance, ArtifactPublisher).
* Provide auditability and immutable exports for auditors (S3 object-lock).
* Provide DRM/encrypted delivery that protects buyer data and enforces license constraints.

---

## 2 — Payment / PCI controls

**Principles**

* Use a PCI-compliant payment provider (e.g., Stripe). Marketplace must not handle or persist PAN, CVV, or raw card data. Use tokenization / hosted pages / payment intents.

**Requirements**

1. **No card data in repo or logs.** CI must run `./scripts/ci/check-no-private-keys.sh` or equivalent grep to ensure no `.pem`, `.key`, or `.env` with secrets are committed.
2. **Webhook validation.** Validate payment provider webhooks by verifying signatures (e.g., Stripe signature header). Implement strict idempotency on webhooks.
3. **Idempotency.** Use `Idempotency-Key` for checkout/finalize endpoints and for webhook handling to avoid double-posting ledger entries.
4. **Segregation.** Payment provider credentials in Vault; limited access. Do not expose these credentials to frontend or client-side code.
5. **Logging & secrets redact.** Ensure logs do not contain PII or payment tokens. Implement log scrubbing for known patterns.

**Verification**

* Pen-test or compliance review for checkout pages and webhook handlers.
* CI job that tests webhook signature validation logic with negative/positive vectors.

---

## 3 — DRM & Encrypted Delivery

**Goals**

* Ensure delivery artifacts are encrypted for the buyer and keys are auditable. Prevent unauthorized access to raw artifacts.

**Modes**

* **Buyer-managed keys (recommended)**: Buyer supplies public key (or KMS binding). Marketplace encrypts with buyer key and provides short-lived access.
* **Marketplace-managed ephemeral keys**: Marketplace requests ephemeral key from KMS/HSM to encrypt delivery. Key provenance and lifecycle must be auditable.

**Controls**

1. **No persistence of plaintext artifacts** in public buckets. Store only encrypted artifacts in S3.
2. **Key provenance recorded** — every delivery audit event must include key id, signer_kid of proof, and `manifestSignatureId`.
3. **Short-lived delivery URLs** — pre-signed URLs must expire quickly (default 1 hour).
4. **Delivery verification** — buyer can call `POST /verify-delivery` to validate artifact hash and proof signature.

**DRM notes**

* Enforce license scope in delivery: e.g., single-user vs enterprise. Server-side checks must match license claims before giving decryption access.
* If using client-side keys, provide a secure key-exchange procedure and do not store private buyer keys.

**Verification**

* Test decryption with buyer-managed key and verify proof/signature flow (`signedProofs.e2e.test.ts`).
* Audit that every successful delivery has a corresponding signed proof and audit event.

---

## 4 — Signing, KMS & signing-proxy requirements

**Principles**

* All audit events, ledger proofs, and delivery proofs must be signed using KMS/HSM or a vetted signing-proxy. Do not commit private keys.

**Requirements**

1. **KMS usage** for production: set `REQUIRE_KMS=true` or `REQUIRE_SIGNING_PROXY=true` in CI for protected branches. CI must fail if the signing path is not reachable. See Kernel CI guard pattern. 
2. **MessageType:DIGEST** for KMS Sign when signing precomputed digests (use `MessageType: 'DIGEST'` for RSA digest signing). See `signAuditHash` KMS semantics. 
3. **Signer registry**: register public keys in `kernel/tools/signers.json` before deprecating prior keys. Keep `signerId` and `deployedAt` metadata for rotation audits. 

**Operational**

* **Rotation plan**: document in `docs/key_rotation.md`. Each rotation must include publishing the public key, verifying new signatures, and deprecating old key only after overlap verification period. 
* **Access & auditing**: restrict signing service rights in IAM (least privilege) and log every sign request.

---

## 5 — Secrets & Vault policy

**Secrets storage**

* All sensitive values (KMS ARNs, signing-proxy API keys, DB credentials, S3 keys, payment provider secrets) must live in Vault/secret manager.

**Access**

* Enforce least privilege: services only read secrets they need. Humans should use ephemeral Vault tokens.

**CI secrets**

* Keep production secrets out of CI logs; use GitHub/Azure/GCP secrets for injecting at runtime.

**Verification**

* CI job to attempt to expose secrets via common patterns and fail PR if leak detected.

---

## 6 — RBAC, mTLS & service-to-service auth

**Principles**

* Kernel mediates high-trust flows. Control-Panel and services must configure mTLS for Kernel & Finance communications where possible.

**Requirements**

1. **mTLS for Kernel & Finance** in production; `DEV_SKIP_MTLS=false`. If mTLS impossible, use short-lived server tokens and enforce rotation.
2. **Audit-source tagging**: every service must include `actor_id` and `service_id` in audit event metadata and logs.
3. **Role capability model**: use Kernel roles (`read:pii`, `annotate:pii`, `operator`, `kernel-approver`) to gate UI/Api capabilities.

**Verification**

* Integration test asserting Kernel-proxied APIs reject unauthenticated calls and reject attempts to leak tokens to clients.

---

## 7 — Audit, export & immutability

**Audit objectives**

* Maintain an append-only audit stream for all orders, payments, delivery, proofs, and key events. Audit records must include `hash`, `prev_hash`, `signature`, `signer_kid`.

**Exports**

* Export audit batches to S3 with Object Lock enabled. Include `pii_included` flag and `pii_policy_version` where relevant. Use `marketplace/tools/export_audit_batch.js` or similar.

**Verification**

* Run `kernel/tools/audit-verify.js` on sampled exported batches to confirm chain integrity. 

---

## 8 — PII handling & data protection

**Principles**

* PII minimization: only retain PII needed for operations.
* Redaction: follow Reasoning Graph PII policy for any traces with PII. When Marketplace attaches buyer PII to audit events, ensure it is controlled and redacted for non-auditor viewers.

**Requirements**

* `pii-catalog.json` listing PII JSON paths and categories.
* Redaction pipeline for UI and exported snapshots; auditor snapshots flagged and stored separately with tighter access.

**Verification**

* Role-based tests that validate redaction behaviour and export flags.

---

## 9 — CI guardrails & pre-merge checks

**Mandatory CI checks**

* **No private keys**: `./scripts/ci/check-no-private-keys.sh`.
* **Signing path reachable** for protected branches (`REQUIRE_SIGNING_PROXY` or `REQUIRE_KMS` enforcement).
* **Contract tests**: `marketplace/api.md` contract must be validated.
* **E2E + audit-verify**: run checkout & signedProofs e2e and run `audit-verify` on sample audit rows.

---

## 10 — Incident response & escalation

**High-impact security incidents**

* **Signing compromise**: rotate signer immediately, revoke access, and publish emergency signer if approved by Security; replay & re-verify proofs as necessary.
* **Payment breach**: investigate with Payment Provider, notify affected parties, follow legal notification requirements.
* **Audit export corruption**: treat as compliance incident—contact Security and Compliance; recover till correct by replay and re-export.

**Contact & escalation**

* Marketplace on-call → Platform SRE → Security → Finance → Product (Ryan) for business-critical decisions.

---

## 11 — Compliance artifacts & audits

Maintain:

* Signed `marketplace/docs/prd-security.md` and runbooks.
* Audit export logs & proof verification evidence.
* Key rotation logs and signer registry commits (with `deployedAt` metadata).
* Security review tokens and tickets showing remediation of issues.

---

## 12 — Checklist for security sign-off

* [ ] Payment flows use a PCI-compliant provider; no PAN/CVV persisted.
* [ ] Webhooks validated; idempotency implemented.
* [ ] Delivery encryption & key provenance implemented and audited.
* [ ] KMS/Signing proxy enforced; public key in Kernel verifier registry. 
* [ ] Audit export to S3 Object Lock with policy reviewed.
* [ ] Secrets in Vault; CI checks for secret leaks.
* [ ] PII handling & redaction tests in place.
* [ ] Security Engineer & Finance Lead sign off.

---

## 13 — Useful commands & verification helpers

```bash
# verify webhook signature with sample header
node marketplace/test/helpers/verifyWebhookSig.js --payload ./test/fixtures/webhook.json --sig $SIG_HEADER --secret $WEBHOOK_SECRET

# run audit verify over marketplace DB
node kernel/tools/audit-verify.js -d "postgres://postgres:postgres@localhost:5432/marketplace" -s kernel/tools/signers.json

# sanity: check for private keys in repo
./scripts/ci/check-no-private-keys.sh
```

---

## Sign-off

Security Engineer and Finance Lead must sign `marketplace/signoffs/security_engineer.sig` and `marketplace/signoffs/finance_lead.sig` per the RepoWriter pattern before production enablement.

---
