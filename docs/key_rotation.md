# Key rotation runbook — Agent Manager audit signing

**Goal:** rotate an audit-signing key (RSA/Ed25519 or HMAC) with no verification gaps, minimal downtime, and a clear rollback plan. This runbook assumes the system signs audit **digests** (`SHA256(canonical || prevHashBytes)`) and verifiers use `kernel/tools/signers.json`.

> Important: prefer **asymmetric** keys (RSA/Ed25519) for public verification. HMAC keys require KMS verify calls or sharing secrets and are more complex to rotate publicly.

---

## Overview (high level)

1. Create a *new* KMS key (asymmetric RSA/Ed25519 or HMAC).
2. Export the new public key and add it to `kernel/tools/signers.json` as a new signer entry **before** switching the signer used by agent-manager.
3. Deploy agent-manager configured to use the *new* key ID (env: `AUDIT_SIGNING_KMS_KEY_ID`, `AUDIT_SIGNING_ALG`, `AUDIT_SIGNER_KID`).
4. Verify new audit events are signed with the new signer id and accepted by `kernel/tools/audit-verify.js`.
5. After a safe overlap period, remove the old signer entry from `signers.json` and optionally disable the old KMS key.

---

## Preconditions & safety

* Have a verified, current `kernel/tools/signers.json` committed (or stored securely) with the **old** signer entry.
* Ensure CI and verifiers run `kernel/tools/audit-verify.js` against the same `signers.json` or that they can fetch the updated registry from a canonical source.
* Ensure you have the IAM ability to create and describe KMS keys and to update deployments.
* Run the steps in a staging/test environment first. Use the e2e script (`kernel/integration/e2e_agent_manager_sign_and_audit.sh`) to validate before production.

---

## Detailed rotation steps

### 0) Choose a rotation window & communication

* Pick a maintenance window or low-traffic time.
* Notify stakeholders (security, oncall, consumers) and record the planned start, rollback point, and contact.

---

### 1) Create a new KMS key

**Asymmetric RSA (example):**

```bash
aws kms create-key \
  --description "Audit signing RSA_2048 key (rotation)" \
  --key-usage SIGN_VERIFY \
  --customer-master-key-spec RSA_2048 \
  --origin AWS_KMS
```

**Ed25519 (example):**

```bash
aws kms create-key \
  --description "Audit signing ED25519 key (rotation)" \
  --key-usage SIGN_VERIFY \
  --customer-master-key-spec ED25519 \
  --origin AWS_KMS
```

**HMAC (symmetric) (example):**

```bash
aws kms create-key \
  --description "Audit HMAC key (rotation)" \
  --key-usage GENERATE_VERIFY_MAC \
  --origin AWS_KMS
```

Record the returned `KeyId` / `ARN`. This will be `NEW_KEY_ID`.

---

### 2) Extract the new public key (asymmetric only)

For asymmetric keys, fetch the public key DER and convert as needed:

```bash
aws kms get-public-key --key-id "$NEW_KEY_ID" --output text --query PublicKey | base64 --decode > new_pub.der
# Convert to PEM (RSA)
openssl rsa -pubin -inform DER -in new_pub.der -pubout -out new_pub.pem
# Or for Ed25519, keep DER or create PEM with OpenSSL >=3.0
```

**Note:** `kernel/tools/audit-verify.js` accepts PEM or base64-DER.

---

### 3) Add new signer entry to signers.json (DO NOT remove old entry yet)

Open `kernel/tools/signers.json` and add an entry:

```json
{
  "signerId": "audit-rotation-2025-11-09",
  "algorithm": "rsa-sha256",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...PEM DATA...\n-----END PUBLIC KEY-----"
}
```

* `signerId` should be unique (e.g., `audit-rotation-YYYYMMDD` or `key-v2`).
* Commit and publish this update before deploying the new key.

---

### 4) Deploy agent-manager with new key configuration

Update configuration:

* `AUDIT_SIGNING_KEY_SOURCE=kms`
* `AUDIT_SIGNING_KMS_KEY_ID=<NEW_KEY_ID>`
* `AUDIT_SIGNING_ALG=rsa-sha256`
* `AUDIT_SIGNER_KID=<NEW_SIGNER_ID>`

Then redeploy agent-manager.

---

### 5) Smoke test & verification

1. Generate new audit events.
2. Confirm new events show the new `signer_kid`.
3. Verify signatures locally:

```bash
node kernel/tools/audit-verify.js -d "postgres://..." -s kernel/tools/signers.json
```

If verification fails, roll back immediately.

---

### 6) Overlap period

Keep both signers active for 24–72 hours to ensure safe verification.

* Monitor verification logs.
* Confirm `kms:Sign` and `kms:GetPublicKey` success in CloudTrail.

---

### 7) Remove old signer and finalize rotation

After the overlap:

1. Remove the old signer from `signers.json`.
2. Commit and publish.
3. Optionally disable the old KMS key:

```bash
aws kms disable-key --key-id "$OLD_KEY_ID"
```

---

## Rollback plan

1. Restore old configuration:

   ```bash
   AUDIT_SIGNING_KMS_KEY_ID=<OLD_KEY_ID>
   AUDIT_SIGNER_KID=<OLD_SIGNER_ID>
   ```
2. Redeploy agent-manager.
3. Re-add old signer entry if removed.
4. Verify via `audit-verify.js`.

---

## Acceptance checks

* `signers.json` includes new signer.
* agent-manager writes new `signer_kid`.
* Verification succeeds for all events.
* No verification errors in logs.
* CloudTrail shows successful signing activity.

---

## Automation ideas

* Script to fetch and append new signer entry automatically.
* CI check validating key schema and PEM format.
* Automated verification job post-rotation.

---

## Notes & gotchas

* Use `MessageType: 'DIGEST'` for RSA signatures.
* HMAC keys cannot export public keys — coordinate carefully.
* Ensure Ed25519 support in SDKs.
* Confirm IAM policies allow `Sign` and `GetPublicKey`.

---

## Quick summary

1. Create new KMS key.
2. Extract public key, add to `signers.json`.
3. Deploy with new key vars.
4. Verify signatures.
5. Wait overlap, then remove old signer.

---

## Post-rotation auditing

* Record who/when/why of the rotation.
* Keep previous `signers.json` for audit retention.
* Monitor CloudTrail for expected signing behavior.

