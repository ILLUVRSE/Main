# Agent Manager — Acceptance Criteria

This document defines the exact acceptance checklist and commands a reviewer must run locally or in CI to validate correctness. Follow each step precisely; if any step fails, stop immediately and report the issue.

> **Goal Summary**
>
> * Agent Manager must sign **a digest**: `SHA256(canonical(payload) || prevHashBytes)`.
> * KMS adapter must support digest signing (`MessageType: 'DIGEST'`) for RSA, and proper flows for HMAC/Ed25519.
> * Verifier (`kernel/tools/audit-verify.js`) must validate digest-based RSA signatures.
> * Canonicalization parity between Node and Go must be proven by tests.
> * All tests (unit, integration, CI) must pass and documentation must exist.

---

## Files that must exist

Ensure these files are present in the repo:

* `agent-manager/server/signAuditHash.js`
* `agent-manager/scripts/verify_last_audit_event_kms_verify.js`
* `agent-manager/test/audit_signer.test.js`
* `agent-manager/test/kms_adapter.test.js`
* `kernel/tools/signers.json.example`
* `kernel/test/node_canonical_parity.test.js`
* `kernel/integration/e2e_agent_manager_sign_and_audit.sh`
* `.github/workflows/agent-manager-ci.yml`
* `docs/kms_iam_policy.md`
* `docs/key_rotation.md`
* `agent-manager/acceptance-criteria.md` (this file)

If any file is missing, the PR is incomplete.

---

## Local unit tests (Node)

1. Install dependencies:

```bash
npm ci
```

2. Run unit tests:

```bash
npm test
```

If no test script exists:

```bash
npx jest --runInBand
```

**Expected result:** All tests pass. Focus on:

* `audit_signer.test.js` — verifies digest flow.
* `kms_adapter.test.js` — checks KMS SignCommand behavior.

---

## Node ↔ Go canonical parity test

Proves canonicalization consistency.

```bash
npx jest kernel/test/node_canonical_parity.test.js --runInBand
```

**Expected result:** Passes or skips if Go not installed.

---

## KMS adapter & signAuditHash

### Unit (mocked KMS)

Checks digest signing behavior:

* `signAuditCanonical` uses `SignCommand` with `Message`.
* `signAuditHash` uses `MessageType: 'DIGEST'`.
* HMAC path calls `GenerateMac`.
* Local RSA fallback emits valid PKCS#1 v1.5 signature.

### Optional Integration (AWS KMS)

```bash
node agent-manager/scripts/verify_last_audit_event_kms_verify.js
```

**Expected result:** Prints `VERIFIED` if configured.

---

## Audit signer behavior & DB verification

Confirm that `audit_signer`:

* Signs digest of `canonical(payload) || prevHashBytes`.
* Persists `signature`, `signer_kid`, `prev_hash`.

**Verify manually:**

```sql
SELECT id, prev_hash, signature, signer_kid FROM audit_events ORDER BY created_at ASC;
```

Recompute digest and verify signature using public key.

**Expected result:** Verification succeeds.

---

## Kernel verifier (RSA support)

`kernel/tools/audit-verify.js` must:

* Accept `rsa-sha256` signers.
* Verify digest-based signatures.
* Support Ed25519 signers.

Test:

```bash
node kernel/tools/audit-verify.js -d "postgres://..." -s kernel/tools/signers.json
```

**Expected result:** Prints `Audit chain verified.`

---

## Integration / e2e smoke test

Run:

```bash
chmod +x kernel/integration/e2e_agent_manager_sign_and_audit.sh
./kernel/integration/e2e_agent_manager_sign_and_audit.sh
```

**Expected result:** Exits 0 and prints `Audit verification succeeded.`

---

## CI workflow

`.github/workflows/agent-manager-ci.yml` must:

* Run Node unit tests.
* Run Go parity tests.
* Run `kernel/ci/require_kms_check.sh` on protected branches.
* Run integration script.

Validate locally:

* Ensure workflow exists.
* Confirm reference to `require_kms_check.sh`.
* Verify CI behavior with and without KMS variables.

---

## Docs & runbooks

Verify these docs exist and are current:

* `docs/kms_iam_policy.md`
* `docs/key_rotation.md`

Ensure clarity on:

* Key creation
* Public key export
* Signers registry updates
* Rotation and rollback

---

## Signers registry

Ensure correct format:

```json
{
  "signers": [
    {
      "signerId": "rsa-signer-1",
      "algorithm": "rsa-sha256",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n..."
    }
  ]
}
```

**Expected:** Verifier can parse and use key.

---

## Security & governance

* KMS IAM policy is least-privilege.
* `require_kms_check.sh` enforced in CI.
* No private key material in logs.

---

## Final acceptance checklist

* [ ] All files exist.
* [ ] Unit tests pass.
* [ ] Node↔Go canonical parity passes.
* [ ] KMS adapter tests pass.
* [ ] `audit_signer` uses digest-based flow.
* [ ] Verifier validates RSA + Ed25519 digests.
* [ ] Integration script passes.
* [ ] CI workflow includes KMS check.
* [ ] Docs present and actionable.
* [ ] Signers registry valid.
* [ ] KMS policy least-privilege.

---

## Troubleshooting

* RSA verification failures: check digest vs message mismatch.
* Canonical parity failures: inspect vector diffs.
* CI failures: confirm `REQUIRE_KMS` and `KMS_ENDPOINT` settings.

---

