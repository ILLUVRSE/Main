# Kernel — Security & Governance (concise, operational)

This document defines the minimum security, key-management, and governance requirements for
running the Kernel in production. It's intentionally short and actionable — use it to obtain
Security sign-off and to guide ops runbooks.

---

# # 1. Scope & goals
- Ensure **all manifests and audit events are signed** by a KMS/HSM-backed key (Ed25519).
- Ensure **audit chain integrity** (hash chaining + signatures).
- Protect signing keys in KMS/HSM; **never store plaintext private keys** in repository or images.
- Provide clear **key rotation**, **compromise**, and **multisig upgrade** workflows that are auditable.

---

# # 2. Key concepts & actors
- **KMS / Signing Proxy** — network service that performs signing operations. The Kernel calls `sign` and `signData`.
- **SignerId** — logical identifier for the signing key used by Kernel (e.g., `kernel-signer-1`).
- **Security Engineer** — approver for KMS/HSM configuration, public key distribution and rotation.
- **SuperAdmin (Ryan)** — final approver for Kernel sign-off and production changes.

---

# # 3. Production requirements (must-have)
1. **KMS/HSM for signing**
   - All production signing operations (manifests, audit hashes) **must** use a KMS/HSM.
   - The Kernel uses `KMS_ENDPOINT` and `SIGNER_ID`. Do **not** fall back to ephemeral keys in prod.
   - KMS must implement an authenticated API for `signManifest` and `signData`. Prefer mTLS + client auth or OAuth tokens scoped to the Kernel service.

2. **Public key distribution**
   - The KMS public key for each `SIGNER_ID` must be available to verifiers (auditors) via a trusted endpoint or the truststore.
   - Public keys must be freely distributable (not secret) and versioned (key id + version).

3. **Signing algorithm**
   - Use Ed25519 for manifest and audit signatures. Signatures must be base64-encoded.
   - Canonicalize payloads deterministically (stable JSON ordering) before signing. The Kernel code must mirror the canonicalization used by verifiers.

4. **Audit chain**
   - Each `audit_event` includes: `prev_hash`, `hash` (SHA-256), `signature`, `signer_id`, `ts`.
   - `hash` = SHA-256(JSON({eventType,payload,prevHash,ts})). `ts` is ISO-8601.
   - Verify chain by re-computing each hash, verifying the prev_hash linkage, and verifying each signature with published public key.

5. **RBAC & Authentication**
   - Human access: OIDC (SSO). Validate tokens server-side; map claims to roles.
   - Service access: mTLS (preferred) or short-lived OAuth tokens. Map service cert/tokens to roles.
   - Canonical roles: `SuperAdmin`, `DivisionLead`, `Operator`, `Auditor`. Enforce with middleware in Kernel for critical endpoints.

6. **Sentinel (policy engine)**
   - Sentinel decisions must be consulted for sensitive actions (`allocation`, `manifest.update`, `upgrade.apply`).
   - Every decision recorded as an `audit_event` with policyId and rationale.

7. **Secrets & CI**
   - Secrets (DB credentials, KMS credentials, deploy tokens) must be stored in a secrets manager (Vault, Fly secrets, GitHub secrets).
   - CI must enforce `REQUIRE_KMS=true` for production pushes or fail the build (see `kernel/ci/require_kms_check.sh`).

---

# # 4. Key rotation & compromise procedure (short)
**Rotation (planned):**
1. Create new key in KMS: `kernel-signer-v2`. Obtain public key.
2. Deploy Kernel in staging to reference `kernel-signer-v2` as an alternate signer (optional).
3. Emit signed audit event `signer.rotation.requested` including `oldSignerId` and `newSignerId`.
4. Obtain approvals (multi-sig if required) — record approval audit events.
5. Mark `kernel-signer-v2` as primary in KMS (atomic switch). Emit `signer.rotation.applied` audit event signed by new key.
6. Keep old key active for overlap period (e.g., 7 days) for verification, then retire in KMS.

**Compromise (urgent):**
1. Immediately disable compromised key in KMS (or mark as compromised).
2. Create a new emergency key (KMS), set `SIGNER_ID` to emergency key for Kernel in staging, verify signing.
3. Emit `signer.compromise` audit event, including timeline and affected manifests.
4. Rotate all affected signing identities with the rotation workflow above.
5. Perform forensic audit on the audit chain, publish findings, and notify stakeholders.

---

# # 5. Multisig / Upgrade workflow (3-of-5, brief)
- Upgrades to Kernel governance objects (e.g., new signer, security policy changes) require **3 distinct approvals**:
  1. Create an **upgrade manifest** describing the change. Signer(s) cannot self-approve.
  2. Collect 3 approval audit events, each with a valid signature from an approved approver identity.
  3. Kernel validates distinct signers and signatures and then applies upgrade, emitting `upgrade.applied` audit event.
  4. Emergency apply: allowed with explicit post-hoc ratification and additional audit entries.

---

# # 6. Verification & tests (must exist)
- Unit tests for:
  - `canonicalizePayload` stability and equivalence across language clients.
  - `computeHash` and audit chaining correctness.
  - `appendAuditEvent` transactional behavior (rollbacks on error).
- Integration tests:
  - Create a manifest → sign → persist → verify signature with public key.
  - Create N audit events and run chain verification tool.
- Operational test:
  - Rotate a key in staging and verify old/new signatures and overlap.

---

# # 7. Operational rules (runbook snippets)
- **Pre-deploy checklist (Security)**
  - KMS endpoint reachable from deploy environment.
  - Public key for `SIGNER_ID` available to auditors.
  - `REQUIRE_KMS=true` set in CI and `KMS_ENDPOINT` present in production secrets.

- **If audit verification fails**
  - Do not accept new writes; escalate to Security Engineer; restore DB snapshot if tampering is suspected; run chain replay from last known-good head.

- **Retention**
  - Audit events: retain raw events for 7 years (or org policy). Use WORM/append-only storage for long-term retention if required.

---

# # 8. Sign-off / approval
- Security Engineer sign-off required before enabling production KMS or setting `REQUIRE_KMS=true` on protected branches.
- Final approver (Ryan — SuperAdmin) signs off on production readiness.

---

# # 9. Short FAQ
**Q:** Can we use ephemeral local signing in prod?
**A:** No. Only for local dev or CI test runs. Production must use KMS/HSM.

**Q:** How do we verify a signature?
**A:** Use Ed25519 verification against canonicalized payload. Examples/tests must be included in verification tooling.

---

Acceptance criteria (one-line):
- Security Engineer confirms KMS contract, key rotation, and audit verification tests; Ryan signs off; `REQUIRE_KMS` enforced in CI for production.

