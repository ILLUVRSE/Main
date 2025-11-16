# Supported Signing Backends

## 1. AWS KMS (Preferred)

**Environment Variables**

* `AUDIT_SIGNING_KMS_KEY_ID` (ARN or KeyId)
* `AUDIT_SIGNING_ALG` (optional: `hmac-sha256`, `rsa-sha256`, `ed25519`)
* `AWS_REGION` / `AWS_DEFAULT_REGION` and AWS credentials

**Notes**

* HMAC uses `GenerateMac` / `VerifyMac` (`HMAC_SHA_256`).
* RSA uses `Sign/Verify` with `MessageType=DIGEST`.
* ED25519 uses `Sign/Verify` when supported.
* IAM permissions required:

  * `kms:Sign`, `kms:Verify` or
  * `kms:GenerateMac`, `kms:VerifyMac` for HMAC.

---

## 2. Signing Proxy / HSM

**Environment Variables**

* `SIGNING_PROXY_URL` (e.g., `https://signer.internal`)
* `SIGNING_PROXY_API_KEY` (optional)

**API**

* `POST /sign/hash` → `{ digest_hex }` → `{ kid, alg, signature }`
* `POST /sign/canonical` → `{ canonical }` → `{ kid, alg, signature }`
* `POST /verify` → `{ digest_hex, signature }` → `{ valid: boolean }`

**Notes**

* Must be secured via mTLS or API key.
* Can be HSM-backed or any trusted signing service.

---

## 3. Mock Signer (Dev/CI Only)

**Environment Variables**

* `MOCK_AUDIT_SIGNING_KEY` (optional) or `AUDIT_SIGNING_KEY`

**Behavior**

* Deterministic HMAC-SHA256 signatures.
* Safe for development and CI.
* **Never use in production.**

---

## 4. Local Private Key Fallback (Emergency Only)

**Environment Variables**

* `AUDIT_SIGNING_KEY` | `AUDIT_SIGNING_PRIVATE_KEY` | `AUDIT_SIGNING_SECRET`
* `AUDIT_SIGNING_ALG` (hmac-sha256 / rsa-sha256 / ed25519)

**Notes**

* Only intended for emergencies.
* In `NODE_ENV=production` or with `REQUIRE_KMS=true`, service will refuse to start without a proper signer.

---

# Runtime Behavior & Guards

* On startup:

  * If `NODE_ENV=production` **or** `REQUIRE_KMS=true`, a valid signer *must* be configured.
  * Missing signer = immediate shutdown with descriptive error.

* Audit flow:

  * Signing happens **before** DB commit.
  * If signing fails → transaction rolls back.

* Digest formula:

  ```
  SHA256(canonicalPayloadBytes || prevHashBytes)
  ```

  Signed using the configured backend.

---

# Recommended Environment Variables (Production)

```text
# AWS KMS (preferred)
AUDIT_SIGNING_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/xxxx
AUDIT_SIGNING_ALG=rsa-sha256

# OR signing proxy
SIGNING_PROXY_URL=https://signer.internal
SIGNING_PROXY_API_KEY=<secret>

# Safety
REQUIRE_KMS=true
NODE_ENV=production
```

**Local / CI**

```text
NODE_ENV=development
AUDIT_SIGNING_KEY=test-ci-signing-key
# or
SIGNING_PROXY_URL=http://localhost:8081
SIGNING_PROXY_API_KEY=local-ci-key
```

---

# How to Sign (Developer Flow)

1. Canonicalize payload:

   ```ts
   auditChain.canonicalizePayload(payload)
   ```
2. Compute digest:

   ```ts
   digestHex = auditChain.computeAuditDigest(canonical, prevHash)
   ```
3. Sign digest:

   ```ts
   auditChain.signAuditDigest(digestHex)
   ```
4. Store `hash`, `prev_hash`, `signature` inside DB transaction.

---

# Verification (Production)

* Check `prev_hash` chaining.
* Recompute canonical → digest and compare to stored hash.
* Verify signature via KMS or signing proxy.
* Audit archive verification:

  * Archived JSON must include SHA-256 and signatures.
  * Tools: `verificationCliWrapper`, `verifyTool`.

---

# Multisig & Manifests (Brief)

* Multisig collects **independent signatures** (N-of-M).
* Not cryptographic threshold signatures.
* For critical manifests:

  * Enforce N-of-M thresholds.
  * Store combined proof immutably in audit archive.

---

# Troubleshooting

### Service refuses to start: "Audit signing is required..."

* Ensure signing backend is configured.
* For KMS: verify AWS creds + region.
* Test with:

  ```bash
  aws kms describe-key --key-id <id>
  ```

### Audit insert fails: `audit signing failed`

* Check KMS permissions and connectivity.
* If proxy: test `/health` and `/sign/hash` manually.
* Inspect server logs.

### `HASH_MISMATCH` or `CHAIN_BROKEN`

* Ensure canonicalization matches stored events.
* Inspect DB rows around broken chain.

### Signature verify failures

* Check algorithm match.
* RSA must use digest-path (`MessageType=DIGEST`).

---

# Scripts & Tools

Start mock proxy:

```bash
SIGNING_PROXY_API_KEY=local-ci-key npx ts-node memory-layer/service/audit/signerProxyMockServer.ts
```

CI helper:

```bash
./memory-layer/service/audit/ci-env-setup.sh
```

Archive audits:

```bash
AUDIT_ARCHIVE_BUCKET=illuvrse-audit-archive-dev npx ts-node memory-layer/service/audit/archiver.ts --limit=1000
```

Verify audits:

```bash
DATABASE_URL=... npx ts-node memory-layer/service/audit/verifyTool.ts --limit=100
```

---

# Security Notes

* Never commit private keys.
* Protect proxy endpoints (mTLS / ACLs).
* Rotate KMS keys regularly.

---

# Additional References

* `memory-layer/docs/runbook_signing.md`
* `memory-layer/service/audit/multisig.ts`
* `memory-layer/service/audit/verifyTool.ts`
* `memory-layer/service/audit/ci-env-setup.sh`

