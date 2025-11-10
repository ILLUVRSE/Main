# Kernel — Acceptance Criteria (Agent-Manager Signing & Verification)

This document defines the **kernel-side acceptance criteria** for the agent-manager signing and verification work (RSA/KMS signing, digest verification, canonical parity, CI, and runbooks). Each item is a testable check with commands to validate locally or in CI.

> **Key Summary:**
>
> * Agent-manager signs a digest: `SHA256(canonical(payload) || prevHashBytes)`.
> * Kernel verifier must verify RSA and Ed25519 signatures using the digest flow.
> * Canonicalization parity between Node and Go must match byte-for-byte.
> * CI must enforce `require_kms_check.sh` and run end-to-end tests.

---

## Files That Must Exist

Ensure the following kernel-side files exist and are updated:

* `kernel/tools/audit-verify.js` — verifies digest flow and RSA/Ed25519 signatures.
* `kernel/tools/signers.json` (or example) — RSA and Ed25519 signer entries:

  ```json
  { "signers": [ { "signerId": "...", "algorithm": "rsa-sha256", "publicKey": "PEM or base64 DER" } ] }
  ```
* `kernel/test/node_canonical_parity.test.js` — Node ↔ Go canonical parity test.
* `kernel/test/audit_verify.test.ts` — RSA verifier unit test.
* `kernel/test/mocks/mockKmsServer.ts` — mock KMS server for tests.
* `kernel/ci/require_kms_check.sh` — CI guard script.
* `.github/workflows/agent-manager-ci.yml` — CI workflow.

If any file is missing, the PR fails acceptance.

---

## Canonicalization Parity

**Goal:** Node and Go canonicalizers must produce identical byte outputs.

**Command:**

```bash
npx jest kernel/test/node_canonical_parity.test.js --runInBand
```

**Expected:** Test passes (byte-for-byte equality) or skips if `go` is unavailable.

If it fails, inspect differences in numeric encoding, string quoting, and key ordering.

---

## Verifier RSA & Ed25519 Support

**Goal:** `audit-verify.js` verifies RSA (rsa-sha256) and Ed25519 (ed25519) signatures correctly.

**Commands:**

```bash
npx jest kernel/test/audit_verify.test.ts --runInBand
```

Manual DB verification:

```bash
node kernel/tools/audit-verify.js -d "postgres://<user>:<pw>@<host>:<port>/<db>" -s kernel/tools/signers.json
```

**Expected:** `Audit chain verified. Head hash: <hex>` and exit code 0.

If it fails, verify signers, `prev_hash` chain, and algorithm/padding.

---

## Mock KMS & Integration Tests

**Goal:** Mock KMS server simulates key exports and signatures.

**Command:**

```bash
npx jest kernel/test/signingProxy.test.ts --runInBand
```

**Expected:** All tests pass and mock returns a valid PEM/base64 DER public key.

---

## Agent-Manager → Kernel E2E Verification

**Goal:** Ensure agent-manager signing and kernel verification work end-to-end.

**Command:**

```bash
chmod +x kernel/integration/e2e_agent_manager_sign_and_audit.sh
./kernel/integration/e2e_agent_manager_sign_and_audit.sh
```

**Expected:** `Audit verification succeeded.` printed; exit code 0.

---

## CI / Policy Enforcement

**Goal:** CI runs tests, parity checks, KMS guard, and integration.

**Requirements:**

* `.github/workflows/agent-manager-ci.yml` runs:

  * Node tests
  * Go parity tests
  * `require_kms_check.sh`
  * e2e script
* `require_kms_check.sh`:

  * Fails if `REQUIRE_KMS=true` and `KMS_ENDPOINT` unset.
  * Passes if `REQUIRE_KMS` false or unset.

**Validation:**

```bash
REQUIRE_KMS=true KMS_ENDPOINT= node kernel/ci/require_kms_check.sh  # should fail
REQUIRE_KMS=false node kernel/ci/require_kms_check.sh  # should pass
```

---

## Signers Registry Format

**Goal:** `audit-verify.js` must accept PEM or base64 DER keys.

**Command:**

```bash
node -e "const fs=require('fs'); const { parseSignerRegistry }=require('./kernel/tools/audit-verify'); const raw=JSON.parse(fs.readFileSync('kernel/tools/signers.json','utf8')); parseSignerRegistry(raw); console.log('ok');"
```

**Expected:** No exceptions; prints `ok`.

---

## Documentation & Runbooks

Ensure presence and accuracy of:

* `docs/kms_iam_policy.md`
* `docs/key_rotation.md`
* `agent-manager/deployment.md`
* `agent-manager/acceptance-criteria.md`

Reviewer should confirm all docs match code behavior (digest, KMS, verification flow).

---

## Security Acceptance

* IAM policy shows least-privilege permissions.
* No private keys in repo.
* CI guard enforced on protected branches.

---

## Final Sign-Off Checklist

* [ ] All kernel tests pass.
* [ ] E2E verification passes.
* [ ] `audit-verify.js` validates RSA & Ed25519 digests.
* [ ] Signers registry schema valid.
* [ ] CI guard + integration jobs configured.
* [ ] Docs present and accurate.
* [ ] No private keys in repo.

---

