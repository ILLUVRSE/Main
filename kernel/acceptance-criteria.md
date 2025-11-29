# Kernel — Acceptance Criteria & Sign-Off

This document serves as the **canonical acceptance criteria** for the `kernel` service. It maps implemented tasks to acceptance requirements, lists verification commands, and tracks sign-offs for production readiness.

> **Scope**: Kernel service (API, Multisig, Audit Log, Signing, Telemetry, SLOs, Runbooks).

---

## 1. Acceptance Matrix

| Feature / Task | Acceptance Criteria | Implementation / Proof | Status |
| :--- | :--- | :--- | :--- |
| **Manifest Signing** | Manifests are signed (Ed25519) and verified. | `kernel/tools/audit-verify.js` handles Ed25519/RSA. Integration tests in `kernel/integration/`. | ✅ Implemented |
| **Audit Chain** | Immutable audit log in Postgres with hash linking (`prevHash`). | `audit_events` table schema. `prevHash` unique constraint. | ✅ Implemented |
| **Multisig** | 3-of-5 threshold governance for proposals. | `multisig_proposals` table. `signingProxy.ts`. Tests in `scripts/test-multisig.sh`. | ✅ Implemented |
| **SLOs** | defined 99.9% availability, latency <500ms targets. | `kernel/docs/SLOs.md`. | ✅ Documented |
| **Runbooks** | Operational guides for high error rates, latency, etc. | `docs/operational-runbook-kernel.md`. Tests in `scripts/test-runbooks.sh`. | ✅ Documented |
| **Telemetry** | Metrics for CPU, start/stop events, audit logging. | Prometheus metrics implemented. Audit logs generated on start/stop. | ✅ Implemented |
| **Security** | Security review completed. No secrets in repo. | `kernel/security-review.txt` present. `kernel/signoffs/` populated. | ✅ Reviewed |

---

## 2. Verification Steps (Reviewer Checklist)

A reviewer must execute the following commands to validate the Kernel service.

### 2.1. Basic Integrity & Tests
Ensure all unit and integration tests pass.

```bash
# Run Kernel test suite (Unit + Integration)
cd kernel
npm install
npm test

# Run Multisig specific tests
./scripts/test-multisig.sh

# Run Runbook verification (mock mode for CI)
./scripts/test-runbooks.sh --mode=mock
```

### 2.2. Audit Chain Verification
Verify the integrity of the audit log chain (hashes and signatures).

```bash
# Verify audit chain (requires Python 3 + deps)
# python3 -m pip install cryptography boto3
python3 tools/verify_audit_chain.py --local-file data/audit_log_dump.json  # If you have a dump
# OR run the JS verifier against a DB
node tools/audit-verify.js -d "$POSTGRES_URL" -s tools/signers.json
```

### 2.3. Signoff Verification
Check that required signoffs are present.

```bash
# Verify signoff files exist
test -f kernel/signoffs/security_engineer.sig && echo "Security Signoff Present"
test -f kernel/signoffs/ryan.sig && echo "Ryan Signoff Present"
```

---

## 3. Telemetry & Audit Verification

To verify that the kernel emits correct telemetry and audit events:

1.  **Start the Kernel**:
    ```bash
    npm start
    ```
2.  **Observe Logs**: Check stdout for `{"event": "kernel.started", ...}`.
3.  **Check Metrics**: Query `/metrics` (if enabled) or check logs for CPU usage stats.
4.  **Audit Events**:
    *   Trigger a signing action: `POST /kernel/sign`.
    *   Verify a new row in `audit_events` with `action='manifest.signed'`.

---

## 4. Security Review Summary

See full review in [kernel/security-review.txt](./security-review.txt).

**Summary**:
*   **Crypto**: Uses Ed25519 for signing, SHA-256 for hashing. Keys managed via KMS in prod, local provider in dev.
*   **Storage**: Postgres for audit log (append-only via chain).
*   **Auth**: mTLS/JWT required for production endpoints.
*   **Secrets**: No hardcoded secrets found. ENV vars used for config.

---

## 5. Sign-Offs

The following approvals indicate that the Kernel service is accepted for production.

*   **Security Engineer**: `kernel/signoffs/security_engineer.sig`
*   **Owner (Ryan)**: `kernel/signoffs/ryan.sig`
