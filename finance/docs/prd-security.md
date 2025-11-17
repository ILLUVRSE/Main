# Finance — Production Security & Compliance

**Purpose**
Security and compliance requirements, controls, and verification steps for the Finance service. This document defines how Finance must handle signing/KMS, secrets, RBAC, high-trust topology, audit immutability, key rotation, CI guardrails, and incident response. Final sign-off required from Security Engineer and Finance Lead.

**Audience:** Security Engineer, Finance Lead, SRE, Devs

---

## 1 — Summary / objectives

* Finance runs in a **high-trust** environment and must protect ledger integrity and proofs.
* All ledger proofs, audit outputs and export bundles **must be cryptographically signed** by KMS/HSM or a vetted signing-proxy. No private keys in repositories or images. 
* Enforce strong transport security (mTLS) for Kernel/Marketplace/ArtifactPublisher integrations.
* Enforce least-privilege IAM and audited operator actions for any manual ledger operations.
* Provide immutable audit exports with Object Lock for compliance; verify chain integrity via `audit-verify`. 

---

## 2 — Signing & KMS (mandatory in production)

**Mandatory policy**

* Production must use **KMS/HSM** or a certified **signing-proxy** for generating all signatures used in ledger proofs and audit artifacts. Set `REQUIRE_KMS=true` or `REQUIRE_SIGNING_PROXY=true` for production and enforce in CI for protected branches. 

**KMS usage & best practices**

* Use an **asymmetric** key (RSA or Ed25519). For RSA precomputed-digest signing, call KMS `Sign` with `MessageType: 'DIGEST'` to avoid canonicalization/format issues. See other modules for examples. 
* Restrict KMS IAM to the Finance service principal only for `Sign` (and `GetPublicKey` if needed). Operators should not have direct `Sign` privileges — use an operator workflow that triggers the Finance service which calls KMS.

**Signing proxy alternative**

* If using a signing-proxy, ensure the proxy:

  * Runs in a trusted environment with audit logging of every request.
  * Requires authenticated calls (mutual TLS or API keys) and enforces rate limits.
  * Returns `{ signature_b64, signer_kid }` and exposes a health endpoint.
  * Publishes public keys (or allows export) so the public key may be added to Kernel verifier registry prior to use. 

**Operational checks**

* CI must verify signing path reachable for protected branch merges. See the Marketplace/Control-Panel CI guard patterns for examples. 

---

## 3 — Signer registry & key rotation

**Signer registry**

* Public keys for any signer used by Finance must be published to Kernel’s verifier registry (`kernel/tools/signers.json`) before the signer is used in production. This ensures verifiers can validate signatures. 

**Rotation process**

1. Create new key in KMS or signing-proxy, record `signer_kid`.
2. Publish public key entry in `kernel/tools/signers.json` (review & commit).
3. Deploy Finance referencing new signer; run smoke tests and `audit-verify` on test ranges.
4. After overlap verification window, decommission old signer entry.
5. Document rotation action and update change log.

**Emergency fallback**

* Emergency signing (temporary signer) is high risk. Only allowed with explicit Security approval and must be accompanied by audit justification. Register emergency signer as above and rotate after incident. 

---

## 4 — Secrets & Vault

**Storage**

* All secrets (DB credentials, KMS ARNs, signing-proxy API keys, S3 credentials) must be stored in Vault or equivalent secret manager. Do not commit secrets.

**Access control**

* Finance service reads secrets at runtime with least-privilege. Human access to secrets must be ephemeral and approved. Use short-lived Vault tokens.

**CI handling**

* Inject only required secrets into CI jobs through protected repository secrets. Mask secrets in logs.

**Verification**

* CI job `check-no-private-keys.sh` must run on PRs and fail if PEM/private key artifacts or `.env` files are committed.

---

## 5 — Transport security & RBAC

**Transport**

* Use **mTLS** for Finance ↔ Kernel and Finance ↔ Marketplace where possible. `DEV_SKIP_MTLS` must be `false` in production. If mTLS cannot be used, require short-lived server tokens with tight scope and rotation.

**RBAC**

* Operator/admin endpoints require OIDC/JWT and roles enforced by Kernel or local RBAC middleware. Enforce `reconcile:run`, `proof:generate`, `admin:journal` capabilities as appropriate.

**Audit**

* All operator actions must create AuditEvents capturing `actor_id`, `reason`, and `signer_kid` if a signing action occurred.

---

## 6 — Audit immutability & export

**Object Lock**

* Exported audit bundles must be written to a dedicated S3 audit archive with **Object Lock** enabled. Ensure export metadata includes policy details and `pii_included` flag. See export runbook for format. 

**Verification**

* Run `kernel/tools/audit-verify.js` or Finance verifier on exported batches to confirm chain integrity as part of CI/nightly checks.

**Retention & access**

* Limit access to audit buckets to auditors and an emergency recovery group. Define retention according to legal/compliance requirements.

---

## 7 — CI & protected-branch guardrails

**Mandatory CI checks**

* Unit tests (ledger balance, idempotency) and integration tests that exercise proof generation and verification.
* Audit verification job that attempts to verify sample proof(s) — best-effort on PRs, required on protected branches.
* Signing path guard job that validates KMS/signing-proxy health for `main`/`release/*` merges (see marketplace/finance CI examples). 

**Secrets & key presence**

* CI must run a repo scan to ensure no private keys or `.env` files were committed.

---

## 8 — Logging, monitoring & alerts

**Logs**

* Sign requests, proof generation events, and reconciliation runs must log minimal info to support audits: `request_id`, `actor_id`, `range`, `signer_kid`, `result`. Do not log private key material or sensitive PII.

**Metrics & alerts**

* `finance.proof_generation_success_total` / `_failure_total`
* `finance.ledger_post_failures_total`
* `finance.reconcile_discrepancies_total`
  Alert on proof generation failures, KMS errors, ledger imbalance detection, and export failures.

**Tracing**

* Include trace IDs in audit events so proof generation and ledger posting can be correlated end-to-end.

---

## 9 — PII & data minimization

* Finance should avoid storing buyer PII beyond what is necessary for reconciliation and compliance. Where PII is stored in audit artifacts, mark exports with `pii_included=true` and enforce stricter access controls. Coordinate with Reasoning Graph PII policy when proofs or traces reference PII. 

---

## 10 — Incident response

### Signing compromise

1. Immediately revoke compromised keys (if possible) and rotate.
2. If immediate rotation fails to restore operations, obtain Security approval to use an emergency signer and follow emergency signing process. Log justification and record AuditEvent. 
3. Re-run `audit-verify` and replay exports as needed.

### Ledger imbalance or reconciliation spike

1. Halt new ledger postings if evidence of systemic corruption.
2. Run reconciliation for recent ranges, identify offending entries, and remediate via reversing entries under controlled audit.
3. Postmortem and remediation plan; update tests to detect the failure mode.

### Audit export failure / Object Lock misconfiguration

* Treat as compliance incident: pause promotions/finalizations relying on fresh exports, restore correct bucket policy, re-run exports and verify.

---

## 11 — Operational checks & commands

```bash
# Verify signing proxy or KMS health (example for signing-proxy)
curl -fsS https://signer.example.com/health

# Run audit-verify on sample Finance DB
node kernel/tools/audit-verify.js -d "postgres://user:pw@localhost:5432/finance" -s kernel/tools/signers.json

# Check for private keys in repo (local quick scan)
./scripts/ci/check-no-private-keys.sh
```

---

## 12 — Compliance sign-off checklist

Before enabling Finance in production, confirm:

* [ ] `REQUIRE_KMS` or `REQUIRE_SIGNING_PROXY` configured and tested; KMS/signing-proxy reachable. 
* [ ] Public signer key published to Kernel verifier registry prior to use. 
* [ ] DB encrypted at rest and TLS enforced for DB connections.
* [ ] Audit export to S3 with Object Lock configured and tested.
* [ ] CI guardrails for signing/check-no-private-keys configured.
* [ ] Reconciliation tooling and DR drills performed.
* [ ] Security Engineer & Finance Lead signoff obtained.

---

## 13 — References

* KMS/key rotation docs: `docs/kms_iam_policy.md`, `docs/key_rotation.md`. 
* Kernel signer registry & audit verifier: `kernel/tools/signers.json` and `kernel/tools/audit-verify.js`.  

---
