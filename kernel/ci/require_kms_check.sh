#!/usr/bin/env bash
#
# kernel/ci/require_kms_check.sh
#
# CI helper to enforce that production builds do not run with ephemeral (dev) signing.
# Intended to be used in CI (GitHub Actions / GitLab CI) as an early guard:
#   - If REQUIRE_KMS=true, fail the build when KMS_ENDPOINT is unset/empty.
#   - Allows local/dev flows when REQUIRE_KMS is false or unset.
#
# Usage (CI):
#   ./kernel/ci/require_kms_check.sh
#
# Notes:
# - This script is intentionally conservative: if REQUIRE_KMS is true and KMS_ENDPOINT is not set,
#   it exits non-zero so CI can block the deployment.
# - DO NOT COMMIT secrets. CI should inject KMS_ENDPOINT and related secrets via protected env vars.
set -euo pipefail

REQUIRE_KMS="${REQUIRE_KMS:-}"
KMS_ENDPOINT="${KMS_ENDPOINT:-}"

# If REQUIRE_KMS is explicitly "false" (or empty), allow missing KMS_ENDPOINT (dev convenience).
if [[ "${REQUIRE_KMS}" == "true" || "${REQUIRE_KMS}" == "1" ]]; then
  if [[ -z "${KMS_ENDPOINT}" ]]; then
    echo "ERROR: REQUIRE_KMS is enabled but KMS_ENDPOINT is not set."
    echo "CI policy: set KMS_ENDPOINT to your KMS signing proxy (or disable REQUIRE_KMS for non-prod runs)."
    echo
    echo "For GitHub Actions, set the secret in the repo/org and expose it via env:"
    echo "  - name: REQUIRE_KMS_CHECK"
    echo "    run: kernel/ci/require_kms_check.sh"
    exit 2
  else
    echo "OK: REQUIRE_KMS is enabled and KMS_ENDPOINT is set."
    echo "KMS_ENDPOINT=${KMS_ENDPOINT}"
    exit 0
  fi
else
  echo "WARN: REQUIRE_KMS is not enabled (REQUIRE_KMS='${REQUIRE_KMS}')."
  echo "This allows local/dev ephemeral signing. Ensure CI/prod sets REQUIRE_KMS=true."
  exit 0
fi

# Acceptance criteria / checks (for maintainers)
# - Script exits 0 when:
#   * REQUIRE_KMS != "true"  (dev permitted), OR
#   * REQUIRE_KMS == "true" and KMS_ENDPOINT is non-empty.
# - Script exits non-zero when REQUIRE_KMS == "true" and KMS_ENDPOINT is empty.
#
# Example GitHub Actions step:
# - name: Enforce KMS in CI
#   run: kernel/ci/require_kms_check.sh
#   env:
#     REQUIRE_KMS: ${{ secrets.REQUIRE_KMS }}
#     KMS_ENDPOINT: ${{ secrets.KMS_ENDPOINT }}
#
# -------------------------------------------------------------------------
# Short checklist: remaining high-priority items to finish the Kernel bootstrap
#
# (This checklist is here so you don't need another message; save file then proceed.)
#
# 1) Wire server to modular router (optional)
#    - Currently `src/server.ts` contains a full server skeleton. You may prefer to
#      import and mount `createKernelRouter()` there to keep handlers in `routes/`.
#
# 2) Add RBAC enforcement across endpoints
#    - Use `src/rbac.ts` and protect critical endpoints:
#       * POST /kernel/division -> DivisionLead | SuperAdmin
#       * POST /kernel/sign -> Service principals or SuperAdmin
#       * GET /kernel/audit/{id} -> Auditor | SuperAdmin
#    - Tests: endpoints return 401/403 for unauthorized/unauthenticated callers.
#
# 3) SentinelNet integration on critical actions
#    - Integrate `src/sentinel/sentinelClient.ts` in allocation and manifest updates (enforcePolicyOrThrow).
#    - Record policy decisions in audit events.
#
# 4) Unit tests for core security primitives
#    - Tests for auditStore.computeHash correctness and appendAuditEvent transactional behavior.
#    - Tests for signingProxy canonicalizePayload and local fallback behavior (and KMS mock).
#
# 5) CI & pipeline
#    - Add a CI workflow that:
#       * Runs `npm ci` / `npm run build`
#       * Runs the require_kms_check script for protected branches/environments
#       * Runs migrations and integration smoke tests (use docker-compose)
#    - Ensure CI injects KMS_ENDPOINT via secrets for prod branches.
#
# 6) Documentation / governance artifacts
#    - Verify `security-governance.md`, `audit-log-spec.md`, `multisig-workflow.md` exist and are current.
#    - If any are missing, add them before final sign-off.
#
# 7) Tests & sign-off
#    - Create unit+integration tests with >=80% coverage for critical modules (signing, audit chaining, multisig validator).
#    - Obtain Security Engineer + Ryan sign-off as per `kernel/acceptance-criteria.md`.
#
# 8) Production hardening
#    - Replace local ephemeral signing with a KMS/HSM-backed client.
#    - Ensure audit_events immutability at storage level or via append-only sink (S3/Kafka with retention policies).
#    - Add monitoring (Prometheus metrics) and alerts for key operations (signing failures, audit pipeline errors).
#
# After completing these items, run the e2e smoke tests: kernel/test/integration/e2e.sh
#
# End of checklist.

