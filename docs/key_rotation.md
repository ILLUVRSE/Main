# Key Rotation & Deprecation — KMS / Signing Keys

## Purpose

This document defines an operational, auditable, and reversible process to rotate signing keys used by ILLUVRSE services (Agent Manager, Kernel, IDEA, etc.). It covers routine rotation, emergency rotation, publishing public keys to the signers registry, updating service configurations, and verification steps. The process assumes keys are managed in KMS/HSM where possible; fallbacks are described for local/dev keys.

**Goals**

* Maintain verifiable audit chains during rotation (no gaps).
* Ensure verifiers (Kernel/tools) can verify signatures across overlapping key windows.
* Provide clear rollback steps when rotation fails.
* Automate verification and CI checks where possible.

---

## Concepts & Terminology

* **Active Key** — key currently used to sign new artifacts/audit events.
* **Verifier Set** — list of public keys known to verifiers, stored in `kernel/tools/signers.json`.
* **Overlap Window** — timeframe when both old and new keys are accepted for verification (recommended).
* **Signer KID** — unique key identifier stored with signatures (e.g., `auditor-signing-v1`).
* **ManifestSignature** — `{ manifest, signature, signer_kid, signed_at }` returned by Kernel sign endpoints.

---

## Rotation Types

1. **Planned Rotation (Routine)** — rotate keys on schedule (e.g., annually or per policy).
2. **Rolling Rotation (Service-by-service)** — rotate one service at a time (recommended for minimal blast radius).
3. **Emergency Rotation** — immediate rotation when a key is suspected compromised; requires multisig approval.

---

## High-level Rotation Principle

1. **Create new key(s)** in KMS/HSM (asymmetric RSA/Ed25519 or symmetric HMAC).
2. **Publish new public key** to verifiers (add to `kernel/tools/signers.json`), **before** switching signers to use the new key. This enables verification of artifacts signed by the new key once used.
3. **Switch signer(s)** to use new key. Signer must stamp signatures with the new `signer_kid`.
4. **Allow overlap** for a predetermined window where verifiers accept both old and new keys.
5. **Deprecate old key** (remove from signer registry) *only after* all verification of new-key-signed artifacts succeeds and after the overlap window passes.
6. **Document & audit** the rotation event as an AuditEvent logged in the platform.

---

## Detailed Routine Rotation Steps (recommended)

> **Assumptions:** You have AWS KMS configured and agent-manager/kernel IAM roles with `kms:Sign` & `kms:GetPublicKey`. Replace placeholders with your values.

### A. Preparation

1. Select `NEW_SIGNER_KID` and `NEW_KEY_DESCRIPTION`.
2. Create the new key in KMS:

```bash
aws kms create-key \
  --description "ILLUVRSE audit signing key - new rotation" \
  --key-usage SIGN_VERIFY \
  --customer-master-key-spec RSA_2048
```

Save the returned KeyId/ARN as `NEW_KEY_ID`.

3. Export public key:

```bash
aws kms get-public-key --key-id "$NEW_KEY_ID" --query PublicKey --output text | base64 --decode > new_public_key.der
# Convert to PEM if needed
openssl rsa -pubin -inform DER -in new_public_key.der -pubout -out new_public_key.pem
```

4. Add the new signer to a staging copy of the signers registry: `kernel/tools/signers.json.staging`:

```json
{
  "signers": [
    {
      "signerId": "auditor-signing-v2",
      "algorithm": "rsa-sha256",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ]
}
```

Use the exact PEM text produced in `new_public_key.pem`.

### B. Publish new signer to verifiers

5. Update the canonical registry used by verifiers (`kernel/tools/signers.json`) in a single, auditable PR/commit. Include:

   * new signer entry (publicKey in PEM)
   * metadata: `deployed_at` and `note` describing rotation
6. CI should validate new `signers.json` parses and that `kernel/tools/audit-verify.js` can load it. The PR should reference the audit event or ticket documenting rotation.

### C. Switch signers to new key (service-by-service)

7. For each signing service (Agent Manager, Kernel if it signs, IDEA if applicable):

   * Update environment variables or KMS configuration to use `NEW_KEY_ID` (`AUDIT_SIGNING_KMS_KEY_ID` or equivalent).
   * Update `AUDIT_SIGNER_KID` to the new `signerId` (e.g., `auditor-signing-v2`).
   * Deploy the service.
   * Emit a test AuditEvent signed with the new key and record its `id` and `signer_kid` in your runbook.

8. Verify the test AuditEvent can be verified by `kernel/tools/audit-verify.js` against `kernel/tools/signers.json`.

### D. Overlap & monitoring

9. Maintain an **overlap window** (e.g., 48–72 hours) during which verifiers accept both old and new signers. Track:

   * frequency of signatures from old vs new key (monitor KMS `Sign` metrics).
   * any verification errors in `audit-verify` or CI.

10. After the overlap window and after confirming new-key signatures verify without issue and old-key usage is negligible:

* Remove old signer from `kernel/tools/signers.json` with a PR that documents the rotation completion.
* Update runbook and close ticket.

---

## Emergency Rotation (compromise)

1. **Immediate actions**

   * Revoke or schedule key destruction in KMS (or disable key). If KMS-managed key cannot be disabled quickly, rotate to new key immediately.
   * Publish new signer entry in `kernel/tools/signers.json` (follow publish steps) and roll signing services to new key (as above).
2. **Replay & forensic**

   * Mark all artifacts signed by the compromised `signer_kid` for review. Use audit queries to list events by `signer_kid`.
   * If necessary, perform a wider security revocation (revoke keys, rotate other keys).
3. **Post-rotation**

   * Run a full end-to-end audit chain verification using `kernel/tools/audit-verify.js` to validate unaffected chains and to qualify impacted ones.
4. **Governance**

   * Emergency rotation must be recorded as an AuditEvent and require postmortem review and multisig sign-off (if configured).

---

## Signer Registry Update Process

1. **Create PR**: Add new signer to `kernel/tools/signers.json` (or staging file). Include public key PEM and `signerId`, `algorithm`, `deployed_at`, and `notes`.
2. **CI checks**:

   * `audit-verify` parsing test: `node kernel/tools/audit-verify.js -s kernel/tools/signers.json` must parse without exception (can run in mock mode).
   * Unit tests for canonicalization parity should pass.
3. **Approval**: Reviewer (Security Engineer) merges PR into main branch.
4. **Deployment**: After PR is merged, update service `AUDIT_SIGNER_KID` and `AUDIT_SIGNING_KMS_KEY_ID` and deploy the service with canary and monitor.
5. **Deprecation**: When safe, remove old signer in a similar PR and document the removal.

---

## CI / Automation Recommendations

* **Automate public key export**: provide a script `agent-manager/scripts/build_signers_from_db_kms_pubkeys.js` that reads KMS ARNs and auto-generates the signers registry entry (PEM + metadata).
* **CI Guard**: `kernel/ci/require_kms_check.sh` should fail builds on protected branches when `REQUIRE_KMS=true` and `KMS_ENDPOINT` absent.
* **Automated verification**: Add a nightly CI job that:

  * pulls recent audit events,
  * runs `kernel/tools/audit-verify.js` against current `signers.json`,
  * flags any events that fail verification.
* **Alerting**: create alerts for spikes in `kms:Sign` errors, or unusual drops in new signer usage during rotation.

---

## Verification & Acceptance Criteria

To consider a rotation successful, perform and document the following checks:

1. **Signer published**: `kernel/tools/signers.json` contains the new signer PEM and `signerId`. (PR + commit ID recorded)
2. **Service switched**: Each signing service has been updated to use `NEW_KEY_ID` and `AUDIT_SIGNER_KID` and produces test signatures using the new signer. (Record example AuditEvent IDs.)
3. **Audit verification**: `kernel/tools/audit-verify.js` validates test AuditEvent(s) signed by the new key. Example:

```bash
node kernel/tools/audit-verify.js -d "postgres://..." -s kernel/tools/signers.json
# Expected: "Audit chain verified" (or the event you created verifies)
```

4. **Overlap & monitoring**: Overlap window completed without verification regressions; metrics show new key usage dominant and old key usage near zero.
5. **Remove old signer**: Old signer removed from `signers.json` only after acceptance checks and overlap window completion.
6. **Documented audit**: Rotation recorded as an AuditEvent and signed; the PR(s) and runbook entries are linked in the rotation ticket.

---

## Rollback / Troubleshooting

* **If new signatures fail verification**:

  * Revert service change to old key while investigating (if old key still valid).
  * Run `audit-verify` locally vs staging signers to debug canonicalization or publicKey formatting issues.
* **If public key is malformed**:

  * Convert DER→PEM properly:

```bash
# DER to PEM for RSA
openssl rsa -pubin -inform DER -in public_key.der -pubout -out public_key.pem
```

* **If KMS Sign fails**:

  * Confirm `kms:Sign` permission, key state (Enabled), and that the signer role has the correct IAM policy.
  * Check CloudTrail logs for `kms:Sign` errors (access denied or key disabled).

---

## Example Commands (quick reference)

**Create new key (AWS KMS RSA)**

```bash
aws kms create-key --description "ILLUVRSE audit signing v2" --key-usage SIGN_VERIFY --customer-master-key-spec RSA_2048
```

**Export public key**

```bash
aws kms get-public-key --key-id "$NEW_KEY_ID" --query PublicKey --output text | base64 --decode > new_public_key.der
openssl rsa -pubin -inform DER -in new_public_key.der -pubout -out new_public_key.pem
```

**Sign digest with KMS**

```bash
# produce 32 byte digest
echo -n '{"payload":1}' | jq -c . | openssl dgst -sha256 -binary > digest.bin
aws kms sign --key-id "$NEW_KEY_ID" --message-type DIGEST --message fileb://digest.bin --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256 --query Signature --output text | base64 --decode > sig.bin
```

**Verify with OpenSSL**

```bash
openssl dgst -sha256 -verify new_public_key.pem -signature sig.bin <(echo -n '{"payload":1}' | jq -c .)
```

---

## Governance & Audit Notes

* Record every rotation as an AuditEvent (who initiated, who approved, PRs merged, PR IDs, affected services, overlap window, verification outcome).
* For multi-account setups, include cross-account principals explicitly in the key policy.
* Rotate keys on a schedule that balances operational risk and cryptographic hygiene (e.g., annually for asymmetric keys; more frequently for HMAC keys).

---

## Next steps after committing this doc

1. Commit `docs/key_rotation.md`.
2. Create automation scripts referenced above (`agent-manager/scripts/build_signers_from_db_kms_pubkeys.js`, `kernel/ci/require_kms_check.sh` if missing).
3. Schedule a planned rotation in a low-traffic window and run the steps in a staging environment before production.

---

## Quick acceptance checklist (for this doc)

* [ ] Documented rotation steps exist in `docs/key_rotation.md`.
* [ ] A sample rotation has been executed in staging and recorded as an AuditEvent.
* [ ] Automation script to export public keys and produce signers JSON is drafted.
* [ ] CI is configured to validate new signers and run `audit-verify` smoke checks.

