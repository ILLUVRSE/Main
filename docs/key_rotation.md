## Signing Key Rotation Runbook (Kernel & Agent Manager)

### 1. Pre-rotation checks
- Confirm new asymmetric KMS keys (RSA 4096 for audit digests, Ed25519 for Agent Manager) exist in the target region and share the same signing algorithms as the retiring keys.
- Ensure the signing IAM role already has `kms:DescribeKey`, `kms:GetPublicKey`, and the relevant `kms:Sign` privileges for the new keys.
- Schedule a deployment window where Kernel verifiers and Agent Manager nodes can reload `kernel/tools/signers.json`.

### 2. Export public keys

```bash
# RSA signing key
RSA_KEY_ARN="arn:aws:kms:us-east-1:123456789012:key/abcd-rsa"
aws kms get-public-key --key-id "$RSA_KEY_ARN" \
  --query PublicKey --output text | base64 --decode > /tmp/rsa_pub.der
openssl rsa -pubin -inform DER -in /tmp/rsa_pub.der -outform PEM \
  -out /tmp/rsa_pub.pem

# Ed25519 signing key
ED_KEY_ARN="arn:aws:kms:us-east-1:123456789012:key/abcd-ed25519"
aws kms get-public-key --key-id "$ED_KEY_ARN" \
  --query PublicKey --output text | base64 --decode > /tmp/ed_pub.der
openssl pkey -pubin -inform DER -in /tmp/ed_pub.der -outform PEM \
  -out /tmp/ed_pub.pem
```

### 3. Update `kernel/tools/signers.json`
1. `cp kernel/tools/signers.json kernel/tools/signers.json.bak`
2. Append new signer objects with fresh `signerId`s, `deployedAt` timestamps, and the PEM blocks from `/tmp/*_pub.pem`. Keep the previous signer entry active until verification succeeds.
3. Validate the file before committing:

```bash
jq '.' kernel/tools/signers.json >/dev/null
```

### 4. Deployment sequence
1. Commit the updated `signers.json` and deploy the Kernel packages that consume it.
2. Update service configuration (Helm values, ECS task env vars, etc.) so `AUDIT_RSA_KEY_ARN`/`AUDIT_ED_KEY_ARN` point at the new keys.
3. Redeploy Agent Manager and any Lambda/worker that signs audit digests so they pull the new environment variables.

### 5. Verification

```bash
#!/usr/bin/env bash
set -euo pipefail
PUB_KEY="$1"           # /tmp/rsa_pub.pem or /tmp/ed_pub.pem
PAYLOAD="$2"           # audit_event.json
SIGNATURE="$3"         # audit_event.sig (base64)
ALG="$4"               # rsa or ed25519

base64 --decode "$SIGNATURE" > /tmp/sig.bin
if [[ "$ALG" == "rsa" ]]; then
  openssl dgst -sha384 -verify "$PUB_KEY" -signature /tmp/sig.bin "$PAYLOAD"
else
  openssl pkeyutl -verify -pubin -inkey "$PUB_KEY" \
    -sigfile /tmp/sig.bin -rawin -in "$PAYLOAD"
fi
echo "Signature verified with $ALG key."
```

Run the script against a freshly signed audit event. Only deprecate the old key after multiple successful verifications across Kernel verifiers and Agent Manager logs show no signature failures.

### 6. Rollback
- If verification fails, revert `kernel/tools/signers.json` to the backup, redeploy the previous configuration, and update env vars back to the old key ARNs.
- Re-enable the old key if it was disabled, and keep the new key disabled until the root cause is corrected.
