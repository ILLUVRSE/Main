# Agent Manager — Deployment & KMS Configuration

This document explains how to deploy **Agent Manager** in development, staging, and production with KMS-backed audit signing. It covers configuration, required environment variables, testing, CI integration, and troubleshooting.

> **Quick Checklist:**
>
> * Agent Manager must sign a **digest**: `SHA256(canonical(payload) || prevHashBytes)`.
> * Use `AUDIT_SIGNING_KEY_SOURCE=kms` in production.
> * Publish the public key in `kernel/tools/signers.json`.
> * Enforce `REQUIRE_KMS=true` in CI for protected branches.

---

## 1) Prerequisites

* Node.js 18+ and npm.
* Postgres database (`DATABASE_URL`).
* For AWS KMS usage:

  * IAM access with `kms:Sign`, `kms:GenerateMac`, `kms:GetPublicKey`, `kms:DescribeKey`.
  * `@aws-sdk/client-kms` dependency in runtime.
* Access to edit `kernel/tools/signers.json`.
* Docker (optional for container deployments).

---

## 2) Environment Variables

Set the following in your deployment environment (env file, Docker Compose, or CI):

### **Core Signing / KMS**

```
AUDIT_SIGNING_KEY_SOURCE=kms
AUDIT_SIGNING_KMS_KEY_ID=arn:aws:kms:REGION:ACCOUNT:key/KEY_ID
AUDIT_SIGNING_ALG=rsa-sha256
AUDIT_SIGNER_KID=auditor-signing-v1
AWS_REGION=us-east-1
```

**For local or test modes:**

```
AUDIT_SIGNING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
AUDIT_SIGNING_KEY_PATH=/secrets/audit_signing_key.pem
AUDIT_SIGNING_KEY_URL=https://secrets.example.com/audit_signing_key
```

### **Verifier Registry**

```
KERNEL_PUBLIC_KEYS_JSON=...
KERNEL_PUBLIC_KEYS_PATH=/secrets/kernel_signers.json
KERNEL_PUBLIC_KEYS_URL=https://keys.example.com/signers.json
```

### **CI & Policy**

```
REQUIRE_KMS=true
KMS_ENDPOINT=...
```

### **Development / Debug**

```
DEV_ALLOW_EPHEMERAL=true
LOG_LEVEL=info
DATABASE_URL=postgres://...
```

---

## 3) Creating a KMS Key

### **RSA 2048**

```bash
aws kms create-key \
  --description "Agent Manager audit signing RSA_2048 key" \
  --key-usage SIGN_VERIFY \
  --customer-master-key-spec RSA_2048
```

### **Ed25519**

```bash
aws kms create-key \
  --description "Agent Manager audit signing ED25519 key" \
  --key-usage SIGN_VERIFY \
  --customer-master-key-spec ED25519
```

### **HMAC (Symmetric)**

```bash
aws kms create-key \
  --description "Agent Manager audit HMAC key" \
  --key-usage GENERATE_VERIFY_MAC
```

Save the `KeyId` or ARN for use in `AUDIT_SIGNING_KMS_KEY_ID`.

---

## 4) IAM / KMS Policy

Reference `docs/kms_iam_policy.md` for a minimal policy.

Agent Manager requires:

* `kms:Sign` or `kms:GenerateMac`
* `kms:GetPublicKey`
* `kms:DescribeKey`

Restrict access to the specific KMS key ARN.

---

## 5) Publishing the Public Key

To verify signatures, verifiers need access to the public key.

Fetch from KMS:

```bash
aws kms get-public-key --key-id "$AUDIT_SIGNING_KMS_KEY_ID" --query PublicKey --output text | base64 --decode > public_key.der
openssl rsa -pubin -inform DER -in public_key.der -pubout -out public_key.pem
```

Update `kernel/tools/signers.json`:

```json
{
  "signers": [
    {
      "signerId": "my-audit-key-v1",
      "algorithm": "rsa-sha256",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ]
}
```

You can automate this using `agent-manager/scripts/build_signers_from_db_kms_pubkeys.js`.

---

## 6) Startup Examples

### **Docker Run**

```bash
docker run -d \
  -e DATABASE_URL="postgres://..." \
  -e AUDIT_SIGNING_KEY_SOURCE=kms \
  -e AUDIT_SIGNING_KMS_KEY_ID="arn:aws:kms:..." \
  -e AUDIT_SIGNING_ALG=rsa-sha256 \
  -e AUDIT_SIGNER_KID=audit-v1 \
  -p 5176:5176 \
  your-image:tag
```

### **systemd Unit Example**

```ini
[Unit]
Description=Agent Manager
After=network.target

[Service]
Environment=DATABASE_URL=postgres://...
Environment=AUDIT_SIGNING_KEY_SOURCE=kms
Environment=AUDIT_SIGNING_KMS_KEY_ID=arn:aws:kms:...
Environment=AUDIT_SIGNING_ALG=rsa-sha256
Environment=AUDIT_SIGNER_KID=audit-v1
WorkingDirectory=/opt/agent-manager
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
User=svc-agent

[Install]
WantedBy=multi-user.target
```

---

## 7) Testing & Smoke Checks

### **A. Unit Tests**

```bash
npm ci && npm test
```

Verify that:

* `audit_signer.test.js` and `kms_adapter.test.js` pass.

### **B. E2E Test**

```bash
chmod +x kernel/integration/e2e_agent_manager_sign_and_audit.sh
./kernel/integration/e2e_agent_manager_sign_and_audit.sh
```

**Expected:** prints `Audit verification succeeded.`

### **C. KMS Verify Script**

```bash
node agent-manager/scripts/verify_last_audit_event_kms_verify.js
```

**Expected:** prints `VERIFIED`.

---

## 8) CI Configuration

* Set `REQUIRE_KMS=true` for protected branches.
* `.github/workflows/agent-manager-ci.yml` should:

  * Run Node tests, Go parity tests, KMS guard script, and integration tests.
* Store AWS/KMS credentials securely in CI.

---

## 9) Key Rotation & Deprecation

Follow `docs/key_rotation.md`.

Summary:

1. Create new key and export public key.
2. Add new signer to `signers.json`.
3. Deploy with new key vars.
4. Verify signatures.
5. Remove old signer after overlap period.

---

## 10) Troubleshooting

### **Signature Verification Fails**

* Ensure `AUDIT_SIGNING_ALG` matches key type.
* Check that digest signing uses `MessageType: 'DIGEST'`.
* Verify public key in `signers.json` is correct.
* Recompute digest manually for comparison.

### **KMS Errors**

* Verify credentials and region.
* Check IAM/KMS key policy.
* Ensure `KMS_ENDPOINT` is reachable.

### **Local Dev Signing**

* Use `AUDIT_SIGNING_PRIVATE_KEY` or enable `DEV_ALLOW_EPHEMERAL=true`.

---

## 11) Security Notes

* Never commit private keys.
* Use asymmetric KMS keys for verification.
* Monitor KMS usage via CloudTrail.

---

