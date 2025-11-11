# Key rotation runbook (Kernel signing keys)

This runbook describes a safe rotation process for KMS-backed signing keys used by the Kernel signing service and the audit pipeline. It covers preparation, rotation steps, verification, rollback, and automation recommendations. Follow this exactly for production rotations.

> **Goals**
>
> * Rotate signing keys with zero downtime for signing and verification.
> * Ensure older signatures remain verifiable for their retention window.
> * Ensure a safe rollback path if something goes wrong.

---

## Pre-rotation checklist (must pass before rotating)

1. **Backups & repo**

   * Ensure code and `kernel/tools/signers.json.example` are committed and pushed to a protected branch.
   * Ensure `kernel/tools/signers.json` in production will be updated via CI/CD (not manually).

2. **Monitoring & Alerts**

   * Ensure KMS logs (CloudTrail / Cloud Audit Logs) are being collected and retained.
   * Ensure alerting for `kms:Sign` errors and for signing-service errors is enabled.

3. **Health & smoke tests**

   * Confirm signing service is healthy and responds to `signManifest` and `signData`.
   * Run `kernel/tools/audit-verify.js` against a sample of signed audit events to ensure verification logic works.
   * Confirm `/ready` endpoints for Kernel and signing services are green.

4. **Signer metadata**

   * Add a new signer entry (draft) to `kernel/tools/signers.json.example` with:

     * `signerId` (unique)
     * `algorithm` (e.g., `ed25519`, `rsa-sha256`)
     * `publicKey` placeholder (PEM or base64)
     * `deployedAt` timestamp (leave blank until live)
     * `notes` describing rotation plan

5. **Retention window**

   * Know audit retention / signature verification period (how long old signatures must remain verifiable). Keep old keys in `signers.json` until beyond that window.

---

## High-level rotation strategy

1. **Create new key** in KMS (or new key version), get public key.
2. **Publish new public key** to `kernel/tools/signers.json` *alongside* old keys (no deletions).
3. **Deploy signing service** with access to new key and start signing with new signerId (or new key version).
4. **Health-check & verification**: verify that new signatures are produced and validated by `audit-verify`.
5. **Gradual cutover** (optional): if service supports canary, route subset of signing requests to new key.
6. **Finalize**: once confident, mark `deployedAt` and document rotation. Keep old public keys until retention window expires, then remove.

---

## Detailed AWS KMS rotation example

### A. Create a new key or key version

* For asymmetric signing, create a new asymmetric Customer Managed Key (CMK) or a new key version.
* Example (console or AWS CLI for asymmetric keys): create a new key with `KeySpec` appropriate for your algorithm (e.g., `RSA_2048`, `ECC_NIST_P256`). For ED25519, use a supported provider if available.

### B. Export public key (if supported)

```bash
aws kms get-public-key --key-id alias/new-signing-key --output text --query PublicKey > new_signer_pub.der
# Convert DER to PEM if needed
openssl pkey -pubin -inform DER -in new_signer_pub.der -outform PEM -out new_signer_pub.pem
```

### C. Add entry to signers.json (staging)

Edit `kernel/tools/signers.json.example` and add:

```json
{
  "signerId": "auditor-signing-ed25519-v2",
  "algorithm": "ed25519",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...PEM...\n-----END PUBLIC KEY-----",
  "deployedAt": null,
  "notes": "Rotation candidate v2"
}
```

Commit as part of a PR (reviewer: security or ops).

### D. Provide IAM rights to signing service

Add a policy allowing `kms:Sign`, `kms:GetPublicKey`, `kms:DescribeKey` on the new key to the signing role. Example (IAM policy snippet):

```json
{
  "Effect": "Allow",
  "Action": ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"],
  "Resource": "arn:aws:kms:REGION:ACCOUNT:key/NEW_KEY_ID"
}
```

### E. Deploy signing service using the new key

* Update configuration (env var) to use new key ARN or key alias.
* If using key versions, configure the signing provider to call `Sign` with the new key version.

### F. Smoke tests & verification

* Create a test manifest and sign it via the signing service.
* Use `kernel/tools/audit-verify.js` or `openssl` to verify signature against `new_signer_pub.pem`.
* Confirm `audit-verify.js` verifies both existing (old) and newly created signatures.

### G. Mark deployed

* Update `kernel/tools/signers.json` (production copy) to include the new signer entry and set `deployedAt` to now in ISO format.
* Keep old signer entries unchanged.

### H. Cleanup (after retention)

* After the retention window, remove old signer entries and revoke old key usage if desired.

---

## Detailed GCP KMS rotation example

### A. Create new key version

```bash
gcloud kms keys versions create --location=LOCATION --keyring=RING --key=KEY
```

### B. Export public key

```bash
gcloud kms keys versions get-public-key VERSION \
  --location=LOCATION --keyring=RING --key=KEY > new_signer_pub.pem
```

### C. Grant `cloudkms.cryptoKeyVersions.useToSign` to signer service account

```bash
gcloud kms keys add-iam-policy-binding KEY \
  --location=LOCATION --keyring=RING \
  --member=serviceAccount:kernel-signing@PROJECT.iam.gserviceaccount.com \
  --role=roles/cloudkms.signerVerifier
```

### D–F. Same as AWS (deploy, smoke-test, mark deployed).

---

## Verification & test checklist (must pass)

1. **Smoke sign**: `curl` to signing service to sign a sample manifest; parse response and ensure `signerId` equals expected new signerId.
2. **Verify signature**: use `kernel/tools/audit-verify.js` with `POSTGRES_URL` and ensure it accepts the new signature(s). Or, use `openssl` / libs to verify raw signature + public key.
3. **Integration test**: run `npx jest kernel/test/signingProxy.test.ts` and `kernel/test/signingProxy.test.ts` focusing on KMS path.
4. **E2E smoke**: run the failing E2E (`e2e_create_sign_spawn_eval_allocate`) to ensure server signs during normal flow.
5. **Monitoring**: confirm no `Sign` failures in logs and no increased error rate.

---

## Rollback plan (if rotation fails)

If verification fails or signing service errors increase:

1. **Reconfigure signing service** to use the previous key (or previous key version). Deploy rollback quickly.
2. **Mark the new signer entry as disabled** in `kernel/tools/signers.json` (add `"disabled": true` on its entry) if necessary to avoid accidental verification attempts.
3. **Re-run smoke tests** to confirm old key/signature path is restored.
4. **Investigate** failure with KMS logs / signing service logs, correct and retry rotation conversatively.

---

## Automation & CI tips

* Use IaC (Terraform) to manage KMS keys and IAM bindings so the rotation is reproducible and auditable.
* Use CI jobs to:

  * create key material (if supported) or create a key version,
  * fetch the public key and add to a `signers.json` staged file,
  * run signing smoke tests in a staging environment,
  * require human approval before merging `signers.json` into production branch.
* Add `kernel/tools/audit-verify.js` as an automated post-rotation verification step.

---

## Security notes

* Never commit private key material to source control. `signers.json` should only contain public keys.
* Use short-lived service credentials and rotate service account keys regularly.
* Limit administrative KMS permissions to authorized ops personnel.
* Maintain an auditable history of `signers.json` changes (pull request reviews + changelogs).

