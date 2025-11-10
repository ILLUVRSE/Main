KMS IAM policy & guidance for Agent-Manager audit signing

Goal: allow the Agent Manager service (or a CI job) to sign audit event digests and to let verifiers retrieve public key material. Use asymmetric keys for RSA/Ed25519 signing and symmetric HMAC keys for HMAC signing. Keep privileges minimal: kms:Sign, kms:Verify, kms:GetPublicKey, kms:GenerateMac, kms:VerifyMac, kms:DescribeKey only on the selected key ARN.
TL;DR: create an asymmetric key (KeyUsage=SIGN_VERIFY, CustomerMasterKeySpec=RSA_2048 or ED25519) for RSA/Ed25519. Grant your Agent Manager IAM role the KMS API permissions below limited to that key ARN. Store the key id/ARN in AUDIT_SIGNING_KMS_KEY_ID and fetch the public key (via GetPublicKey) to populate your kernel/tools/signers.json.

Key types & AWS KMS notes

RSA (PKCS#1 v1.5 or PSS) — create an asymmetric key with KeyUsage: SIGN_VERIFY and CustomerMasterKeySpec: RSA_2048 (or RSA_3072 / RSA_4096 if you need larger keys). Use KMS signing algorithm RSASSA_PKCS1_V1_5_SHA_256 for PKCS#1 v1.5 or RSASSA_PSS_SHA_256 for PSS. When signing a precomputed digest, pass MessageType: 'DIGEST' to Sign.

Ed25519 — create an asymmetric key with CustomerMasterKeySpec: ED25519 and KeyUsage: SIGN_VERIFY. Use SigningAlgorithm: 'ED25519'.

HMAC (symmetric) — create a symmetric KMS key for HMAC operations and use GenerateMac / VerifyMac with MacAlgorithm: 'HMAC_SHA_256'. HMAC keys are KeyUsage: GENERATE_VERIFY_MAC in newer APIs.

Public key retrieval — GetPublicKey returns the public key bytes (DER). Use that to populate kernel/tools/signers.json so kernel verifier can create a Node crypto publicKey object or the Go verifier can read DER.

Minimal IAM policy for the Agent Manager service (example)

Replace REGION, ACCOUNT_ID, and KEY_ID with your values. Limit Resource to the specific KMS key ARN (or alias ARN). This policy allows the service principal (IAM role used by agent-manager) to call the necessary KMS methods on the key.

{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowKmsSignVerifyGetPublicKey",
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:Verify",
        "kms:GetPublicKey",
        "kms:DescribeKey",
        "kms:GenerateMac",
        "kms:VerifyMac"
      ],
      "Resource": "arn:aws:kms:REGION:ACCOUNT_ID:key/KEY_ID"
    },
    {
      "Sid": "AllowListAliasesOptional",
      "Effect": "Allow",
      "Action": [
        "kms:ListAliases",
        "kms:ListKeys"
      ],
      "Resource": "*"
    }
  ]
}

Notes:

If you put the key behind an alias, you can use the alias ARN instead: arn:aws:kms:REGION:ACCOUNT_ID:alias/my-audit-signing-key.

kms:GetPublicKey is required for verifiers or tooling that need the public key. Do not grant kms:CreateKey or wide admin permissions here.

If agent-manager signs using KMS, it only needs Sign (or GenerateMac for HMAC). Verify is only needed if the same role will verify. GetPublicKey is necessary only for processes that need to export the public key into kernel/tools/signers.json.

Example key creation (AWS CLI)
Create an asymmetric RSA key (for RSA-SHA256)
aws kms create-key \
  --description "Agent Manager audit signing RSA_2048 key" \
  --key-usage SIGN_VERIFY \
  --customer-master-key-spec RSA_2048 \
  --origin AWS_KMS

Create an Ed25519 key
aws kms create-key \
  --description "Agent Manager audit signing ED25519 key" \
  --key-usage SIGN_VERIFY \
  --customer-master-key-spec ED25519 \
  --origin AWS_KMS

Create an HMAC symmetric key
aws kms create-key \
  --description "Agent Manager audit HMAC key" \
  --key-usage GENERATE_VERIFY_MAC \
  --origin AWS_KMS

After creation you’ll receive a KeyId and Arn. Use that as AUDIT_SIGNING_KMS_KEY_ID (or AUDIT_SIGNER_KID depending on config).

Fetching the public key (DER / base64) for registry

To export the public key (so you can put it in kernel/tools/signers.json):
# GetPublicKey returns base64-encoded DER in the CLI output (PublicKey is binary)
aws kms get-public-key --key-id arn:aws:kms:REGION:ACCOUNT_ID:key/KEY_ID --output text --query PublicKey | base64 --decode > public_key.der

Convert DER to PEM (optional):
openssl rsa -pubin -inform DER -in public_key.der -pubout -out public_key.pem   # for RSA
# For Ed25519 use openssl (OpenSSL >= 3.0) or encode base64 DER directly; kernel verifier accepts PEM or base64 DER.

Populate signers.json (example entry):
{
  "signers": [
    {
      "signerId": "integration-rsa-test",
      "algorithm": "rsa-sha256",
      "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANB...IDAQAB\n-----END PUBLIC KEY-----"
    }
  ]
}

You can also store base64 DER (no PEM wrapper) — kernel/tools/audit-verify.js accepts either.

KMS key policy / trust notes

The KMS key policy is the single most important gate. In many setups you keep the default KMS key policy (AWS account root + admin). If you want the best separation, put a key policy that explicitly allows the Agent Manager IAM role to Sign/GenerateMac and GetPublicKey.

When in doubt, attach an IAM policy (example above) to the Agent Manager role and keep a narrow KMS key policy that allows the account administrators plus kms:ViaService if needed.

For cross-account signing or CI systems, prefer granting an IAM role in the account that runs agent-manager and avoid adding wide-access key policies.

Key rotation runbook (quick steps)

Important: Asymmetric KMS keys do not rotate their private key material automatically in a way that preserves the public key. For audit signing you must plan rotation carefully.

Create a new KMS key (asymmetric RSA/Ed25519) for the new key pair.

Fetch the new public key via aws kms get-public-key and add it to kernel/tools/signers.json (or kernel/tools/signers.json in a controlled registry).

Deploy agent-manager with AUDIT_SIGNING_KMS_KEY_ID pointing to the new key ARN. For zero-downtime, ensure the verifier accepts both old and new signers in signers.json.

Run verification (e2e smoke) and check a few signed events succeed with the new key.

Remove old public key from signers.json only after you're confident older signatures are no longer needed (or are archived).

Optionally, schedule the old key for disable (not deletion) first. Only delete keys after long retention and audit confirmation.

Notes: For automatic rotation semantics you must implement a registry that can store multiple signers and let kernel verifier accept multiple signerIds (we already support signers.json registry). Rotation is a manual process: create new key, update registry, update env, test, then deprecate old key.

Least-privilege checklist
Agent Manager IAM role has only kms:Sign (or kms:GenerateMac for HMAC) + kms:GetPublicKey + kms:DescribeKey scoped to the single key ARN.
CI/Verifier jobs that only need public key have kms:GetPublicKey (or you export public key once and store in repo/secure storage).
Key policy restricts who can change the key (not everyone should be able to update key policy or schedule deletion).
Use CloudTrail + KMS logging/metrics to monitor Sign, GetPublicKey, GenerateMac, etc.
For production, set REQUIRE_KMS=true in CI to prevent accidental deployments with ephemeral keys.

Common pitfalls & gotchas
Signing digest vs message: for RSA we must set MessageType: 'DIGEST' when calling Sign with a precomputed digest. If you pass the canonical string as Message, KMS will hash it internally; that’s a different signing shape and can break verification parity if your verifier expects a digest-based signature. Our implementation uses a digest flow (SHA256(canonical || prevHashBytes)) and KMS MessageType: 'DIGEST'.

Public key encoding: KMS GetPublicKey returns a DER-encoded SubjectPublicKeyInfo. You can use it as base64 DER or convert to PEM. Verifiers accept both.

HMAC keys: HMAC keys are symmetric; you cannot GetPublicKey. Verifiers must call VerifyMac/Verify against KMS to validate signatures — or share the HMAC secret (not recommended). Prefer asymmetric keys for public verification.

Ed25519 support: Requires recent AWS KMS features and up-to-date SDK/CLI. Ensure your runtime supports ED25519 and your verifier supports Ed25519 signature verification.

Contact / audit review

If in doubt, ask Security for a short review:

Provide KeyId / ARN, KeyPolicy, IAM role ARN for agent-manager, and the proposed signers.json public key entry.

Provide a plan for rotation and retention of old keys.

That’s it — use the example IAM policy above, create an asymmetric KMS key for RSA/Ed25519 (or symmetric for HMAC), restrict permissions to the KMS key ARN, export the public key into kernel/tools/signers.json, and follow the rotation runbook when rotating keys.
