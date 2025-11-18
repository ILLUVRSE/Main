# Eval Engine & Resource Allocator — Security & Governance

## Purpose

Define the minimum security, KMS, RBAC, audit, and governance controls required for Eval Engine and Resource Allocator prior to production acceptance. Security sign-off requires evidence for each item below.

---

## Principles (non-negotiable)

* **No private keys in repo or images.** All signing must use KMS/HSM or a centralized signing proxy. CI may use test keys only when `DEV_ALLOW_EPHEMERAL=true` and never when `NODE_ENV=production`.
* **mTLS for service-to-service** communications in production; `REQUIRE_MTLS=true` must be enforced in production.
* **OIDC for humans** (SSO) with mapped roles for operator/admin access.
* **Audit-first**: every state-changing action must emit append-only AuditEvent including `prevHash`, `hash`, `signature` and `signer_kid` (or reference to Kernel-signed anchor). Audit emissions must be atomic with state mutation.
* **Least privilege**: services and code-runner identities must have least privilege IAM/KMS policies.
* **Policy gating**: SentinelNet policy checks must be invoked for promotion/allocation flows; denials or multisig requirements must result in correct response codes and audit emission.

---

## KMS & Signing

* **Production signing must use KMS/HSM** (`AUDIT_SIGNING_KMS_KEY_ID` for audit signing and `MANIFEST_SIGNING_KMS_KEY_ID` for any manifest signing where applicable).
* **Signer identity**: each signing key is published to Kernel verifier registry (`kernel/tools/signers.json`) or equivalent. Use `signer_kid` identifiers.
* **Signing semantics**:

  * The service computes canonicalized digest per Kernel rules and sends digest to KMS or signing proxy with `MessageType: 'DIGEST'` where applicable.
  * KMS must be used for `Sign` and `Verify` operations. For HMAC/MAC, ensure proper MAC verification semantics.
* **Rotation & deprecation**:

  * Documented key rotation steps required in `eval-engine/runbooks/key_rotation.md`.
  * Public keys must be published before switching production signer; maintain overlap window.

---

## Transport & Authentication

* **mTLS**:

  * `REQUIRE_MTLS=true` in production.
  * Short-lived certs via Vault PKI or internal CA.
  * Enforce mutual authentication between Kernel ↔ Eval Engine ↔ Resource Allocator ↔ SentinelNet ↔ Finance.
* **OIDC**:

  * OIDC for humans. Roles to enforce: `superadmin`, `eval-admin`, `operator`, `auditor`.
  * Use group/claim mapping and role-to-privilege mappings documented in `eval-engine/security/oidc-mapping.md`.
* **Service tokens**:

  * Use short-lived tokens/certs. If tokens are used instead of mTLS, rotate frequently and restrict scope.

---

## RBAC & Privilege Model

* **Role mapping**:

  * `kernel-service` — Kernel mTLS client (full write authority via Kernel mediation).
  * `eval-service` — internal Eval Engine service identity (ingestion & scoring writes mediated by kernel).
  * `operator` / `eval-admin` — human operator privileges (exclusively via OIDC).
  * `auditor` — read-only PII-capable role (explicitly granted).
* **Enforcement**:

  * All admin endpoints must validate role and return `403` on insufficient privileges.
  * Operator UI calls must be server-proxied to avoid exposing secrets to browsers.

---

## Audit Model & Chain Verification

* **AuditEvent structure** must include (at a minimum):

  * `id`, `eventType`, `payload`, `prevHash`, `hash`, `signature` (or pointer), `signer_kid`, `manifestSignatureId` (where applicable), `actor`, `ts`.
* **Atomicity**:

  * Writes to DB and audit emission must be atomic. If impossible, implement a two-phase commit pattern with durability guarantee and a replay tool.
* **Verification tooling**:

  * Provide `node kernel/tools/audit-verify.js` / `memory-layer/service/audit/verifyTool.ts` usage examples in `eval-engine/docs/` and CI tasks that run audit verification on produced sample events.
* **Archive**:

  * Audit events must be archived to S3 with Object Lock (COMPLIANCE) for long-term retention; document retention periods.

---

## SentinelNet Integration & Policy

* **Synchronous gating**:

  * Promotion/allocation flows must call SentinelNet synchronously when required by policy. If denied, the call must return `403` with `policy` details in error.
* **Multisig**:

  * If policy indicates `requires_multisig`, the flow must transition to `pending_multisig` and not apply until Kernel indicates `applied`.
* **Simulation & dry-run**:

  * Eval Engine must support `simulate=true` or dry-run capabilities for policy tests.

---

## Finance & Ledger Interactions

* **Ledger proofs**:

  * Resource allocation settlement requires Finance-signed ledger proofs. Eval Engine/Allocator must validate ledger proof signatures prior to finalizing allocations.
* **Isolation**:

  * Finance workloads should be isolated in different network segments and IAM boundaries.
* **Reconciliation**:

  * Provide reconciler runbook and `eval-engine/scripts/reconcile_allocations.sh` to check allocations vs finance ledger.

---

## Secrets & Repository Hygiene

* **No private keys or secrets** in the repo. CI must run `./scripts/ci/check-no-private-keys.sh` on PRs.
* **Vault**: use Vault Agent Injector / CSI driver in K8s for runtime secrets. Document secret paths and access controls.
* **CI credentials**: store in secret manager; do not add to `package-lock` or logs.

---

## PII, Data Handling & Legal-hold

* **PII detection**: integrate PII detection in telemetry & memory ingestion paths; block exposure and surface redaction errors.
* **Legal-hold**: implement legal-hold semantics that prevent deletion and ensure audit evidence of holds.
* **Access control**: PII fields are only exposed for `auditor` role; ensure read endpoints enforce this.

---

## Observability, Monitoring & Incident Response

* **Metrics**: ensure required SLO metrics are emitted (promotions, p95/p99 latency, policy denial counts).
* **Alerts**: KMS failures, audit failures, SentinelNet denial spikes, Finance settlement failures — alert pages must exist.
* **Runbooks**: `eval-engine/runbooks/incident_kms.md`, `incident_sentinel.md`, `incident_finance.md` must exist and be referenced in acceptance.

---

## CI / PR Guards

* **REQUIRE_KMS guard**: Protected branches must enforce `REQUIRE_KMS=true` or run signing-proxy mock tests.
* **Tests to execute in CI**:

  * Unit tests, contract tests, KMS guard script, audit verify sample, integration tests for promotion-allocation flows (with mocks).
* **Secrets scanning**: run `trufflehog/gitleaks` or equivalent on PRs.

---

## Key Rotation & Compromise

* **Rotate**:

  * Documented rotation steps and overlap windows for all KMS keys used by Eval Engine.
* **Compromise**:

  * If KMS key compromised, follow emergency rotation runbook: disable key, create new key, publish public key, re-run verification on recent events.

---

## Acceptance Evidence (for Security sign-off)

Security sign-off for the module requires the following evidence items:

* `eval-engine/acceptance-criteria.md` implemented & tests green. 
* `REQUIRE_MTLS=true` enforced in production and `DEV_SKIP_MTLS=false` for prod.
* KMS integration validated in staging (`AUDIT_SIGNING_KMS_KEY_ID` tested).
* Audit events produced by the module verified by `kernel/tools/audit-verify.js` for a sample range.
* SentinelNet gating tested for allow/deny/multisig cases.
* Finance settlement flows tested in staging with ledger proof verification.
* CI guardrails: secrets scanning and `REQUIRE_KMS` checks in place.
* Runbooks and incident response docs exist and tabletop drill executed.

---

## Minimal IAM / KMS policy examples

* **KMS Sign policy** (example):

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":["kms:Sign","kms:Verify","kms:GetPublicKey"],
      "Resource":"arn:aws:kms:REGION:ACCOUNT:key/EVAL_SIGNING_KEY"
    }
  ]
}
```

---

## Final signoffs required

* `eval-engine/signoffs/security_engineer.sig` — Security Engineer (created). 
* `eval-engine/signoffs/ryan.sig` — Final approver (created). 

---

End of `eval-engine/security-governance.md`.

---
