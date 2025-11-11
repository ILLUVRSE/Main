# KMS / IAM Policy (Minimal, Least-Privilege)

## Purpose

This document prescribes the recommended IAM and KMS key-policy configuration for services that need to:

* **Sign** audit events or manifests (asymmetric RSA or Ed25519),
* **Generate/verify MACs** for HMAC-based signatures,
* **Export public keys** (to populate `kernel/tools/signers.json`) for verifiers.

The goal is *least-privilege access*, auditable usage, and clear operational steps to rotate/replace keys without breaking the audit chain.

---

## Roles / Principals (example)

Create a dedicated IAM role for each service that needs to sign or generate MACs:

* `role/illuvrse-agent-manager-signing` — used by Agent Manager
* `role/illuvrse-kernel-signing` — used by Kernel (if Kernel needs signing privileges)
* `role/illuvrse-audit-verifier` — reader-only access to `kms:GetPublicKey` (verifiers)
* `role/illuvrse-ci` — CI job role that may need `kms:GetPublicKey` to validate chain in CI

**Principle:** do *not* reuse human credentials or long-lived user keys. Use IAM roles (ECS Task Role / EC2 instance profile / IAM role for service account) or short-lived credentials via OIDC or STS.

---

## Allowed KMS Actions (minimum)

Grant these KMS actions **only** on the signing key ARN(s):

* `kms:Sign` — required for RSA/Ed25519 signing operations.
* `kms:GenerateMac` — required for symmetric HMAC-style keys.
* `kms:GetPublicKey` — required for verifiers to export the public key.
* `kms:DescribeKey` — to check key metadata / key state.
* (Optional) `kms:ListAliases` / `kms:ListKeys` — not required; avoid unless necessary.

**Do not** grant `kms:CreateKey` or broad administrative actions unless explicitly required and audited.

---

## Example IAM policy (Agent Manager signer)

Replace placeholders (`REGION`, `ACCOUNT`, `KEY_ID`) with your values.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowKMSSigning",
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:GenerateMac",
        "kms:GetPublicKey",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:REGION:ACCOUNT:key/KEY_ID"
    }
  ]
}
```

Attach this policy to the service IAM role (for example, `role/illuvrse-agent-manager-signing`).

---

## Recommended KMS key policy (minimal)

The KMS key policy must allow the AWS account root and the specific service role to use the key. Example (partial):

```json
{
  "Version": "2012-10-17",
  "Id": "key-policy-illuvrse-audit-signing",
  "Statement": [
    {
      "Sid": "AllowAccountAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::ACCOUNT:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowAgentManagerToUseKey",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::ACCOUNT:role/illuvrse-agent-manager-signing" },
      "Action": [
        "kms:Sign",
        "kms:GenerateMac",
        "kms:GetPublicKey",
        "kms:DescribeKey",
        "kms:ListGrants",
        "kms:CreateGrant",
        "kms:RevokeGrant"
      ],
      "Resource": "*"
    }
  ]
}
```

**Notes:**

* Use `CreateGrant` / `ListGrants` only if your environment uses grants for cross-account or cross-service access patterns.
* If you use cross-account principals, the key policy must include those principals explicitly.

---

## Conditions & Restrictions

Add conditions where possible:

* Restrict to the **exact** KMS key ARN(s) via `Resource`.
* Add `aws:SourceVpc`, `aws:SourceIp`, or VPC endpoint conditions if your services run inside a constrained network.
* Deny access when `aws:ViaAWSService` is non-compliant for your topology (optional).

**Example condition snippet** (restrict to a single VPC endpoint):

```json
"Condition": {
  "StringEquals": {
    "aws:sourceVpc": "vpc-0abcd1234"
  }
}
```

(Use only when your deployment topology supports it and you can maintain keys in multi-region/multi-vpc setups.)

---

## Key types & usage patterns

* **Asymmetric RSA_2048** — for RSA PKCS#1 v1.5 signatures (`rsa-sha256`) and `Sign` use. Use `MessageType=DIGEST` for KMS Sign when signing precomputed digests.
* **Asymmetric ED25519** — for Ed25519 signatures.
* **Symmetric (HMAC)** — for `GenerateMac` / `VerifyMac` paths when HMAC is the desired signing method.

**AWS CLI examples**

* Create RSA key:

```bash
aws kms create-key --description "Agent Manager RSA signing key" --key-usage SIGN_VERIFY --customer-master-key-spec RSA_2048
```

* Get public key:

```bash
aws kms get-public-key --key-id "$AUDIT_SIGNING_KMS_KEY_ID" --query PublicKey --output text | base64 --decode > public_key.der
```

* Sign digest (RSA, KMS):

```bash
# hash.bin contains the 32 byte SHA-256 digest
aws kms sign --key-id "$AUDIT_SIGNING_KMS_KEY_ID" --message-type DIGEST --message fileb://hash.bin --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256 --output text --query Signature | base64 --decode > signature.bin
```

* Generate MAC (HMAC):

```bash
aws kms generate-mac --key-id "$MAC_KEY_ID" --message fileb://message.bin --mac-algorithm HMAC_SHA_256 --query Mac --output text | base64 --decode > mac.bin
```

---

## Operational guidance

* **Public key publishing**: After key creation, export public key and add it to `kernel/tools/signers.json` (or `signers.json.example`), following the signers registry format. Automate with `agent-manager/scripts/build_signers_from_db_kms_pubkeys.js` or similar.
* **CloudTrail**: Ensure CloudTrail logs `kms:Sign`, `kms:GenerateMac`, and `kms:GetPublicKey` for auditing.
* **Monitoring**: Alert on unusual KMS usage (spikes in Sign calls), `FailedAttempts`, and changes to the key policy.
* **No private keys in repo**: NEVER put private key material into the repository. Use KMS or secure secrets (Vault).

---

## Acceptance criteria (for this doc and policy)

* An IAM policy exists for each signing role that grants **only** the actions listed and only on the configured key ARN(s).
* KMS key policy includes the service role(s) that need signing rights and allows `kms:GetPublicKey`.
* CI or manual test confirms `aws kms sign` and `aws kms get-public-key` succeed using the service role or a temporary credential for that role.
* CloudTrail is configured to log KMS signing and public-key exports.
* Public key(s) are exported and an example `kernel/tools/signers.json.example` is provided.

---

## Verification steps (quick)

1. **Simulate that the role can call Sign**

```bash
aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::ACCOUNT:role/illuvrse-agent-manager-signing --action-names kms:Sign --resource-arns arn:aws:kms:REGION:ACCOUNT:key/KEY_ID
```

Expected: `EvalDecision` = `allowed`.

2. **Sign a known digest (dev or CI)**

```bash
# compute digest
echo -n '{"test":1}' | jq -c . | openssl dgst -sha256 -binary > digest.bin
aws kms sign --key-id "$AUDIT_SIGNING_KMS_KEY_ID" --message-type DIGEST --message fileb://digest.bin --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256 --query Signature --output text | base64 --decode > sig.bin
openssl dgst -sha256 -verify public_key.pem -signature sig.bin <(echo -n '{"test":1}' | jq -c .)
```

Expected: verification succeeds.

3. **Export public key and check format**

```bash
aws kms get-public-key --key-id "$AUDIT_SIGNING_KMS_KEY_ID" --query PublicKey --output text | base64 --decode > public_key.der
# convert to PEM if needed
openssl rsa -pubin -inform DER -in public_key.der -pubout -out public_key.pem
```

