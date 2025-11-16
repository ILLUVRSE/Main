# Memory Layer — Signing & KMS Runbook

This runbook documents the signing architecture, operational procedures, and emergency steps for audit signing used by the Memory Layer.

It covers:
- supported signing backends (KMS, signing proxy, mock signer)
- configuration & IAM
- key rotation and multisig upgrade workflow
- startup / readiness expectations
- incident response and recovery steps

> **Important**: signing is a security-critical capability. In production `REQUIRE_KMS=true` or `NODE_ENV=production` the service must refuse to start if no signer is configured.

---

## 1. Supported signing backends

1. **AWS KMS (preferred)**  
   - Use `AUDIT_SIGNING_KMS_KEY_ID` to point to a KMS Key ARN or KeyId.  
   - Supported algorithms: HMAC (HMAC_SHA_256), RSA (RSASSA_PKCS1_V1_5_SHA_256), ED25519 (if your KMS supports it).  
   - Use digest-path signing: compute 32-byte SHA-256 digest locally and call KMS `Sign` with `MessageType=DIGEST` (for RSA) or `GenerateMac` for HMAC.

2. **Signing proxy / HSM (alternative)**  
   - `SIGNING_PROXY_URL` points to an internal signing proxy that exposes `/sign/hash`, `/sign/canonical`, `/verify`.  
   - The proxy must authenticate callers (mTLS or API key). Use `SIGNING_PROXY_API_KEY` for local CI mock.

3. **Local mock signer (tests/dev only)**  
   - `MOCK_AUDIT_SIGNING_KEY` or `AUDIT_SIGNING_KEY` used by mock signer or `auditChain` fallback for local dev and CI.  
   - Do not use in production.

---

## 2. Environment variables

- `AUDIT_SIGNING_KMS_KEY_ID` — KMS KeyId / ARN (preferred for prod).  
- `AUDIT_SIGNING_ALG` — `hmac-sha256`, `rsa-sha256`, `ed25519` (default `hmac-sha256`).  
- `SIGNING_PROXY_URL` — signing proxy base URL (optional).  
- `SIGNING_PROXY_API_KEY` — api key for signing proxy (optional for CI/dev).  
- `AUDIT_SIGNING_KEY` / `MOCK_AUDIT_SIGNING_KEY` — local fallback key for tests/dev (not for prod!).  
- `REQUIRE_KMS` — if `true`, server refuses to start unless a signing capability is available.  
- `NODE_ENV=production` — server performs strict startup check and fails fast if no signer configured.

---

## 3. Startup checks (service/server.ts)

On startup the Memory Layer enforces:
- If `NODE_ENV=production` or `REQUIRE_KMS=true`, at least one of the following must be present:
  - `AUDIT_SIGNING_KMS_KEY_ID`
  - `SIGNING_PROXY_URL`
  - `AUDIT_SIGNING_KEY` / `AUDIT_SIGNING_PRIVATE_KEY` (emergency only)
- If none are present the service exits with an actionable error message and non-zero status.

Readiness endpoints:
- `/readyz` aggregates `getAuditHealth()` which probes KMS (DescribeKey), signing proxy (basic GET), and mock signer (test sign/verify). If no configured signer, `/readyz` returns degraded.

---

## 4. IAM & KMS recommendations

- Use an asymmetric KMS key (RSA or ED25519) or HMAC key depending on policy. Prefer asymmetric keys for signature verification with a public key.
- Grant minimal permissions to the service role:
  - `kms:Sign`, `kms:Verify` (if needed) for asymmetric keys
  - `kms:GenerateMac`, `kms:VerifyMac` for HMAC keys
  - Restrict by `Resource` to the audit signing key(s)
- Key policy: only the service signing principal (and an emergency admin role) should be allowed to sign.
- Enable KMS key rotation policy and document key rotation window in `docs/key_rotation.md`.

---

## 5. Multisig upgrade / rollback workflow (3-of-5 pattern)

**Goal**: require N-of-M approvals for producing or approving critical manifests or system upgrades.

1. **Signer set**: prepare 5 operator-run signing endpoints (KMS keys or signing proxy endpoints) with distinct operator access control.
2. **Threshold**: choose threshold = 3. Coordinator (operator tool) collects signatures from signers.
3. **Flow**:
   - Operator creates `upgrade manifest` payload (canonical JSON).
   - Coordinator collects signatures by calling each signer (KMS or signing proxy) to sign the digest.
   - Once at least 3 valid signatures collected, coordinator creates a combined proof object `{ digestHex, signatures, threshold }` and stores it as a signed `manifest` artifact.
   - Kernel/agents verify combined proof before applying critical changes.
4. **Rollback**:
   - Rollback manifests follow the same multisig flow and require the same threshold.
5. **Audit**:
   - Each signature collection step emits `audit_events` showing signer id and proof metadata.
   - Store the combined proof in an S3 object-lock (immutable) for future audits.

**Notes**: the current multisig helper is aggregate-based (multiple independent signatures) and not a threshold cryptographic signature (not single compact sig). For stronger cryptographic properties consider a threshold-signature library.

---

## 6. Key rotation & compromise handling

**Planned rotation steps**:
1. Provision new KMS key (or new signer key). Add to multisig signer set as "candidate".
2. Test signer by signing training payloads and verifying via `verifyTool`.
3. Update service configuration (staged environment) to include new key and run integration test suit.
4. Promote new key in production with multisig approval. Record promotion as audit event.

**If a key is compromised**:
1. Revoke / disable affected KMS key immediately.
2. Generate a replacement key and add to signer set.
3. Use multisig flow to approve switchover.
4. Re-run `memoryctl audit verify` against archived audit logs to validate chain integrity.
5. Notify Security team and run full forensic audit.

---

## 7. CI & local dev guidance

- CI uses `AUDIT_SIGNING_KEY` or `SIGNING_PROXY_URL` with `SIGNING_PROXY_API_KEY` and the included `signerProxyMockServer` or `mockSigner`. Use `memory-layer/service/audit/ci-env-setup.sh` to auto-start the mock proxy during CI jobs.
- For integration tests running in CI, set:
  - `AUDIT_SIGNING_KEY=test-ci-signing-key`
  - `SIGNING_PROXY_URL=http://localhost:8081` (if using mock proxy)
  - `REQUIRE_KMS=false`
- In CI, after tests the audit verification step must run `memory-layer/service/audit/verifyTool.ts` to ensure digest chaining and signatures verify.

---

## 8. Operational troubleshooting

**Startup failure: "Audit signing is required but no signer is configured"**
- Validate environment variables listed in section 2.
- If expecting KMS, ensure AWS credentials & region available and `AUDIT_SIGNING_KMS_KEY_ID` is correct.
- If using signing proxy, confirm `SIGNING_PROXY_URL` reachable and `SIGNING_PROXY_API_KEY` (if set) matches.

**Signing errors during insertAuditEvent (runtime)**
- Check service logs for error details.
- Run `memory-layer/service/audit/healthChecks.ts` (or hitting `/readyz`) to see which signer failed.
- If KMS is unreachable, verify networking and IAM permissions; attempt a single `aws kms describe-key --key-id <id>`.

**Verification failures**
- Use `memory-layer/service/audit/verifyTool.ts` to replay/verify audit chain. For archived bundles, use `memory-layer/service/audit/verificationCliWrapper.ts`.

---

## 9. DR + archive policy

- Archive audit export to S3 object-lock bucket nightly. Use `memory-layer/service/audit/archiver.ts`.
- Retention: minimum 365 days (policy must be documented in `memory-layer/deployment.md`).
- Quarterly DR drill:
  1. Restore an archived object.
  2. Run `verificationCliWrapper` to compute SHA and compare with manifest.
  3. Replay into staging DB and run `verifyTool` to ensure chain integrity.

---

## 10. Contacts & sign-off

- Security: [security@example.com]  
- SRE / Oncall: [sre@example.com]  
- Product owner & final approver for Memory Layer: Ryan Lueckenotte

**Sign-off procedure**: Once acceptance criteria pass, final approver must record sign-off as a signed audit event (`memory.layer.signoff`) referencing the acceptance checklist and commit/PR id.

---

## 11. Change log

- v1 — Initial runbook covering KMS, proxy, multisig, and CI/dev flow.

---

Save this runbook in the repo and use it as the canonical operational guidance for audit signing.  

