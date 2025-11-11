# KMS / IAM Policy (kernel)

This document specifies the minimum IAM/KMS configuration required for Kernel signing operations and CI/acceptance flows. It is intentionally concise and prescriptive so you can copy/paste the examples and apply them in your cloud account.

> **Principles**
>
> * Least privilege: agents and services get only the keys/permissions they need to sign or verify.
> * Separation of duties: signing private key usage is limited to signing services; verification uses public keys only.
> * Auditability: every signer principal should be auditable and have a unique signer id.
> * Rotation: automated rotation process with documented rollout and rollback steps.

---

## 1 — What the Kernel needs

* A KMS key (or keyring) that can produce signatures (asymmetric) or that your signing service uses to sign.
* A “signer service account” (or role) with permission to use the KMS **sign** operation.
* A short-lived or long-running signing service that calls KMS to sign manifests / data.
* A public key registry (`kernel/tools/signers.json`) populated with the current public key(s) and signer IDs.
* Audit and logging enabled for KMS operations.

Minimum operations the kernel will perform:

* `signManifest(manifest)` — call to signing service which, in production, calls KMS sign API.
* `signData(data)` — call to signing service which signs raw data.
* `verify` operations are done using the public key only (no KMS needed).

---

## 2 — AWS KMS example

**Assumptions**

* Use an asymmetric RSA/ECDSA/Ed25519 key in AWS KMS (Customer managed key).
* Signer principal is an IAM role assumed by the signing service (e.g., `arn:aws:iam::123456789012:role/kernel-signing-role`).

### Minimal IAM role policy for signing

Attach this policy to the signing role. Replace `REGION` and `ACCOUNT_ID` and `KEY_ID`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowKmsSign",
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:GetPublicKey",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:REGION:ACCOUNT_ID:key/KEY_ID"
    },
    {
      "Sid": "AllowLogging",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

### Key policy (KMS)

Grant the account root and the signing role use permissions. Keep it minimal and add principals as needed.

```json
{
  "Version": "2012-10-17",
  "Id": "key-default-1",
  "Statement": [
    {
      "Sid": "AllowAccountUseOfTheKey",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::ACCOUNT_ID:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowKernelSigningRole",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::ACCOUNT_ID:role/kernel-signing-role" },
      "Action": [
        "kms:Sign",
        "kms:GetPublicKey",
        "kms:DescribeKey"
      ],
      "Resource": "*"
    }
  ]
}
```

**Notes**

* Enable CloudTrail for KMS to capture `Sign` operations.
* Use asymmetric key types appropriate for your signing algorithms (RSA/ED25519).
* Use `kms:GetPublicKey` to export the public key for `kernel/tools/signers.json` if needed.

---

## 3 — GCP KMS example

**Assumptions**

* GCP Cloud KMS asymmetric key (e.g., `projects/PROJECT/locations/LOCATION/keyRings/RING/cryptoKeys/KEY/cryptoKeyVersions/VERSION`).
* Signer principal is a Service Account: `projects/PROJECT/serviceAccounts/kernel-signing@PROJECT.iam.gserviceaccount.com`.

### Minimal IAM binding for signing (gcloud)

Give the signer the `roles/cloudkms.signerVerifier` or a custom role with `cloudkms.cryptoKeyVersions.useToSign`.

```bash
gcloud kms keys add-iam-policy-binding KEY \
  --location=LOCATION \
  --keyring=RING \
  --member=serviceAccount:kernel-signing@PROJECT.iam.gserviceaccount.com \
  --role=roles/cloudkms.signerVerifier
```

Or custom IAM role that grants:

* `cloudkms.cryptoKeyVersions.useToSign`
* `cloudkms.cryptoKeyVersions.get`
* `cloudkms.keys.get`

**Notes**

* Use IAM audit logs for `cryptoKeyVersions.useToSign` events.
* Export public key via `gcloud kms keys versions get-public-key` and add to `kernel/tools/signers.json`.

---

## 4 — Key rotation & signer registry

**Rotation process (summary):**

1. Generate new key version in KMS or create new KMS key (depending on provider).
2. Add new signer entry to `kernel/tools/signers.json.example` locally with `signerId`, `algorithm`, and `publicKey` (PEM). Include `deployedAt`.
3. Deploy signing service with new key access (or update role). Start using new key for new signatures.
4. Keep the old public key in `signers.json` for a deprecation window to verify older signatures.
5. Once old signatures are beyond retention/expiry, remove the old public key entry.

**Signer registry example entry** (already used in repo):

```json
{
  "signerId": "auditor-signing-ed25519-v2",
  "algorithm": "ed25519",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----",
  "deployedAt": "2025-11-10T00:00:00Z",
  "notes": "Rotated 2025-11-10; previous signer: auditor-signing-ed25519-v1"
}
```

**Important**

* `signerId` is the canonical id used by audit/signature records.
* Keep `publicKey` in PEM form if possible to simplify verification code.

---

## 5 — Auditing & Monitoring

* Ensure KMS sign operations are logged (CloudTrail / Cloud Audit Logs).
* Monitor metrics or alerts for:

  * Unexpected sign rate increases.
  * Signer failures / unauthorized attempts.
  * KMS health/unreachability.
* On suspicious activity, rotate keys immediately and investigate logs.

---

## 6 — Least-privilege checklist

For production, ensure:

* Signing role/service account has `Sign` permissions only — no broad `kms:*` unless required for management.
* Public verification processes and apps only have read access to `signers.json` (or a signed registry) — they must not have access to signing keys.
* The CI runner & developers do not hold long-lived KMS signing privileges; use short-lived credentials or dedicated signing deployments.

---

## 7 — Troubleshooting

* `Sign` API failing: Confirm signer role has `Sign` rights on the key and the key is in `ENABLED` state.
* Public key mismatch: Export public key from KMS (`GetPublicKey` / `gcloud kms keys versions get-public-key`) and verify it matches `signers.json`.
* Audit verification failures: Run `kernel/tools/audit-verify.js`, inspect failure messages, check `signers.json` entries and key algorithms.

---

## 8 — Operational notes

* Store `signers.json` in source control as `signers.json.example`. Only populate production `kernel/tools/signers.json` from secure CI/CD processes or secrets store.
* Keep rotation runbook (next doc) closeby; automate export/import where possible.

