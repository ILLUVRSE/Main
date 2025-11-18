# Agent Manager — Security & Governance

## Purpose
This document defines the security, signing, and governance controls required for Agent Manager before production acceptance. Agent Manager is responsible for:
- Verifying Kernel-signed manifests (production `illuvrse` profile)
- Emitting append-only AuditEvents for state-changing actions
- Running sandbox jobs with isolation and no secret leakage
Security sign-off requires evidence for the items below.

---

## Scope & goals
- Ensure **manifest verification** with Kernel signatures and reject unsigned manifests for production profiles.
- Ensure **audit chain integrity**: every critical change emits an AuditEvent (sha256, prevHash, signature, signer_kid, ts).
- Protect signing keys in KMS/HSM; **never** commit private keys in repo or images.
- Enforce **RBAC** (OIDC for humans) and **mTLS** for service-to-service calls.
- Provide **CI guardrails** that enforce `REQUIRE_KMS=true` on protected branches and run secrets checks.

---

## Key concepts
- **KMS / Signing Proxy** — service used to sign audit digests when Agent Manager must emit a signature. Prefer mTLS access to a signing proxy or cloud KMS APIs (Ed25519/RSA as required).
- **SignerId / signer_kid** — logical identifier for the key used to sign AuditEvent or other artifacts (mirror Kernel naming).
- **Kernel** — authoritative gate that issues manifest signatures and is the only principal permitted to authorize writes to reasoning/other write-only services.
- **Security Engineer** — approver for KMS contract, IAM policy, and final signoff.

---

## Production requirements (must-have)
1. **KMS/HSM for signing**
   - All production signing (audit digests or local attestations) MUST use KMS/HSM. Configure:
     - `AUDIT_SIGNING_KEY_SOURCE=kms`
     - `AUDIT_SIGNING_KMS_KEY_ID=<arn or keyId>`
     - `AUDIT_SIGNER_KID=<signer-kid>`
   - If using a signing proxy, configure `SIGNING_PROXY_URL`, prefer mTLS + client cert or scoped API key.

2. **Manifest verification**
   - Agent Manager must verify Kernel-signed manifests for any `profile === "illuvrse"` agent_config.
   - Verification must include:
     - manifestSignature verification against the Kernel public key
     - manifest fingerprint/hash check vs artifact store
     - checking `manifestSignatureId` presence in Kernel trust registry (or via Kernel API)

3. **Audit emission**
   - Every state-changing action (spawn, start/stop/scale, sandbox run creation/completion, template create/update) must emit a signed AuditEvent with:
     - `id`, `eventType`, `payload`, `prevHash`, `hash` (SHA-256), `signature` (base64), `signerId`, `ts`
   - The compute of `hash` must follow Kernel canonicalization rules (use shared library or canonicalizer helper).
   - The signing step must be atomic with append/emit (avoid gaps between hash/signature and write).

4. **RBAC & Authentication**
   - Human flows: OIDC / SSO. Map claims to roles: `operator`, `kernel-approver`, `kernel-admin`, `auditor`.
   - Service flows: mTLS (preferred) or short-lived OAuth tokens. Map CN to service role via middleware.
   - All admin/admin-ish endpoints must validate caller role and fail with `403` if insufficient.

5. **mTLS (production)**
   - Enforce mTLS for Kernel ↔ Agent-Manager. If mTLS is unavailable, use server-side token with strict rotation and minimal scope, but mTLS is the production requirement.
   - In dev/test, guard with `DEV_SKIP_MTLS=true`. Startup must fail if `NODE_ENV=production` and `DEV_SKIP_MTLS=true`.

6. **Secrets & repo hygiene**
   - No private keys or secrets committed in repo or images.
   - Use Vault / cloud secrets and inject at runtime via CSI driver or environment secrets safely.
   - CI must scan for secrets and fail PRs that include private key patterns.

7. **Sandbox & runtime isolation**
   - Sandbox runner must enforce CPU/memory/timebox and network egress controls.
   - No persistent secrets or long-lived keys should be available inside sandbox sessions.
   - Sandbox runs must be auditable (create audit event on create/complete/fail/timeout).

---

## Key rotation & compromise procedure (short)
- **Rotation (planned)**
  1. Create new key in KMS and obtain public key.
  2. Add new public key to kernel/tools/signers.json or equivalent trust store.
  3. Stage Agent Manager to accept the new signer (dual-mode) and smoke test signing/verify.
  4. Switch primary signer_kid and emit signed audit event `signer.rotation.requested` and `signer.rotation.applied`.
  5. Keep old key enabled for an overlap period (e.g., 7 days) then retire.

- **Compromise (urgent)**
  1. Disable compromised key in KMS immediately.
  2. Create emergency key and configure Agent Manager to use it in staging to validate.
  3. Emit `signer.compromise` audit event with timeline.
  4. Rotate affected keys and run full chain verification.

---

## CI / Protected-branch guardrails
- **Require KMS for protected branches**: CI job must check `REQUIRE_KMS=true` for branches that deploy to staging/prod and fail if missing.
- **Secrets scanning**: run `./scripts/ci/check-no-private-keys.sh` or equivalent on each PR.
- **Contract tests**: OpenAPI contract tests, manifest verification unit tests, and audit parity tests must run in CI.

---

## Implementation checklist (evidence for sign-off)
Agent Manager is security-accepted when all bullets below have automated evidence or signed manual evidence:
- [ ] Manifest verification implemented and unit-tested (valid/invalid).
- [ ] Audit emission implemented; `memory-layer/service/audit/verifyTool.ts` or `kernel/tools/audit-verify.js` verifies sample chain including Agent Manager events.
- [ ] KMS integration (staging): `AUDIT_SIGNING_KMS_KEY_ID` set and `AUDIT_SIGNER_KID` verified via verify script.
- [ ] RBAC & mTLS enforced for service and admin endpoints (tests that exercise unauthenticated/unauthorized access).
- [ ] Sandbox isolation (CPU/memory/time) and no secret leakage confirmed by integration tests.
- [ ] CI guard `REQUIRE_KMS=true` in protected branch pipeline and secret-scanning job passing.
- [ ] Key rotation tested in staging (rotate + overlap + verify).
- [ ] Signoff: `agent-manager/signoffs/security_engineer.sig` present.

---

## How to verify (commands)
- Unit & integration tests:
  ```bash
  # From repo root
  npm ci --prefix agent-manager
  npm test --prefix agent-manager
````

* KMS / signing smoke:

  ```bash
  # ensure AUDIT_SIGNING_KMS_KEY_ID is set
  node agent-manager/scripts/verify_last_audit_event_kms_verify.js
  ```

* Manifest verification test:

  ```bash
  # run manifest acceptance tests (valid/invalid cases)
  npm test --prefix agent-manager -- manifest-verification.test.js
  ```

* Audit chain verification (sample):

  ```bash
  # run kernel audit verification against a sample DB with Agent Manager events
  node kernel/tools/audit-verify.js -d "postgres://postgres:postgres@localhost:5432/illuvrse" -s kernel/tools/signers.json
  ```

* Sandbox smoke:

  ```bash
  # create agent & run sandbox in dev mode
  curl -X POST http://localhost:5176/api/v1/agent/spawn -d '{"agent_config": {"name":"demo","profile":"personal"}}' -H 'Content-Type: application/json'
  curl -X POST http://localhost:5176/api/v1/agent/<agent_id>/sandbox/run -d '{"tests":["echo hello"], "timeout_seconds":30}' -H 'Content-Type: application/json'
  ```

---

## Minimal IAM / KMS policy (example)

Grant only sign & verify to Agent Manager role:

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":[
        "kms:Sign",
        "kms:Verify",
        "kms:GetPublicKey"
      ],
      "Resource":"arn:aws:kms:REGION:ACCOUNT:key/AGENT_MANAGER_SIGNING_KEY"
    }
  ]
}
```

---

## Tests & acceptance evidence to attach

* Unit tests covering canonicalization and hash/signature code paths.
* Integration test that creates an agent with a signed manifest and validates success.
* Integration test that attempts a spawn with unsigned manifest (profile `illuvrse`) and expects `403`.
* Audit verification logs showing Agent Manager events present and signatures verified.
* Sandbox run logs showing timeouts, resource enforcement, and no secret leakage.
* CI logs showing `REQUIRE_KMS` enforced for protected branches.

---

## Sign-off

Security Engineer signoff: create `agent-manager/signoffs/security_engineer.sig` with the signed approval and add remarks if any.

Final approver (Ryan) signoff: create `agent-manager/signoffs/ryan.sig` once all items above are validated.

---

End of file

```

