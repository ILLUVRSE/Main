# ILLUVRSE Kernel Runbook — Integration Tests (OIDC + mTLS + CI)

**Location:** `docs/illuvrse-kernel-runbook.md`  
**Purpose:** concise, explicit runbook for reviewers and CI owners to run the integration tests locally and in CI, list secrets, and show acceptance criteria.

## 1) High-level goal
Run the Kernel integration tests that exercise OIDC (Keycloak) and mTLS (client certs) in a Docker Compose stack — both locally and in GitHub Actions — while keeping secrets out of the repo and ensuring tests are gated and auditable.

## 2) Files added/changed (summary)
**New files created (important):**
- `devops/secure-cert-management.md`
- `devops/scripts/ci_wait_for_service.sh`
- `devops/scripts/ci_inject_certs.sh`
- `devops/mock-kms/Dockerfile`
- `devops/mock-kms/server.js`
- `devops/mock-kms/README.md`
- `kernel/src/auth/roleMapping.ts`
- `kernel/test/unit/rbac.unit.test.ts`
- `kernel/test/unit/require_roles.unit.test.ts`
- `kernel/test/unit/require_any.unit.test.ts`
- `kernel/test/integration/rbac.integration.test.ts`
- `kernel/test/integration/kms.integration.test.ts`
- `kernel/test/mocks/mockSentinel.ts`
- `kernel/src/sentinelClient.ts`
- `kernel/scripts/check_sentinel.ts` *(helper)*
- `.github/workflows/integration-tests.yml`

**Existing files updated (important):**
- `kernel/src/server.ts` — adds guarded endpoints (`/principal`, `/require-any`, `/require-roles`) and exports `checkKmsReachable`.
- (Later) `devops/docker-compose.ci.yml` and `kernel/src/auth/middleware.ts` will be updated in next steps.

## 3) Exact secrets required (names and content)
Store these as **base64**-encoded secrets in the repo (Settings → Secrets):

- `CI_KERNEL_CA` — base64(kernel-ca.crt)  
- `CI_KERNEL_SERVER_CERT` — base64(kernel-server.crt)  
- `CI_KERNEL_SERVER_KEY` — base64(kernel-server.key)  
- `CI_KERNEL_CLIENT_CERT` — base64(kernel-client.crt)  
- `CI_KERNEL_CLIENT_KEY` — base64(kernel-client.key)

(These are the files you used locally in `/tmp/illuvrse-certs`.)


## 4) How to run locally (exact commands)

**Prereqs**
- Docker, `docker compose`, Node 18+, npm, `gh` cli (optional).

**Create local certs** (you already have them in `/tmp/illuvrse-certs`).

**Start compose for local test run**
```bash
export ILLUVRSE_CERT_DIR=/tmp/illuvrse-certs
export MTLS_REQUIRE_CLIENT_CERT=false
export ENABLE_TEST_ENDPOINTS=true
docker compose -f devops/docker-compose.ci.yml up -d --build

Provision Keycloak (idempotent)
chmod +x devops/scripts/prepare_oidc.sh
./devops/scripts/prepare_oidc.sh
# Expect: "Realm testrealm created." or "Realm testrealm already exists."

Trust CA & run the integration test
export NODE_EXTRA_CA_CERTS=/tmp/illuvrse-certs/kernel-ca.crt
cd kernel
npm ci
npx jest test/integration/auth.integration.test.ts --runInBand --detectOpenHandles

Quick RBAC-only test (in-process)
cd kernel
npx jest test/integration/rbac.integration.test.ts --runInBand

5) How CI runs (summary of .github/workflows/integration-tests.yml)

CI injects cert secrets into /tmp/illuvrse-certs via devops/scripts/ci_inject_certs.sh.

Sets env:

ILLUVRSE_CERT_DIR=/tmp/illuvrse-certs

MTLS_REQUIRE_CLIENT_CERT=false

ENABLE_TEST_ENDPOINTS=true

Builds images, brings compose up, waits for Keycloak readiness.

Runs ./devops/scripts/prepare_oidc.sh.

Runs cd kernel && npm ci && NODE_EXTRA_CA_CERTS=/tmp/illuvrse-certs/kernel-ca.crt npx jest test/integration/auth.integration.test.ts --runInBand.

Tears down stack and uploads logs on failure.

6) Verification checklist (what reviewers should check)

CI workflow runs on the branch and completes with jest PASS for auth.integration.test.ts.

Kernel logs show: Kernel HTTPS server listening on port 3000 and ENABLE_TEST_ENDPOINTS=true -> installing test-only endpoints.

curl to container /health and /ready return expected statuses.

No NODE_TLS_REJECT_UNAUTHORIZED=0 used in CI (we use NODE_EXTRA_CA_CERTS).

devops/secure-cert-management.md is reviewed and secrets are base64'd and rotated as documented.

7) Next steps & responsibilities for reviewer

CI owner: add the five CI_KERNEL_* secrets as base64 contents.

Security owner: review devops/secure-cert-management.md and confirm production plan (Vault / docker secrets).

Dev owner: decide whether to switch Keycloak healthcheck to curl in the Keycloak image or keep port-listen approach; update devops/docker-compose.ci.yml accordingly.

8) Acceptance criteria (restate)

Integration tests for OIDC + mTLS pass in CI and locally.

Test-only endpoints only available when ENABLE_TEST_ENDPOINTS=true or when NODE_ENV=test.

No insecure key permissions are required in CI or production.

RBAC mapping and sentinel audit stubs in place and covered by unit/integration tests.

9) Troubleshooting pointers (common failures)

404 on test endpoints: ensure ENABLE_TEST_ENDPOINTS=true or run tests under NODE_ENV=test.

TLS errors: confirm NODE_EXTRA_CA_CERTS points to kernel CA or CI injected certs exist.

Keycloak not ready: inspect Keycloak logs and re-run prepare_oidc.sh.

Permissions to certs: CI uses ephemeral runner; avoid chmod 644 in prod.

10) How to proceed from here (one-file-at-a-time)

You told me to do files one at a time. I followed that. Next, pick one existing file to update (for example kernel/src/auth/middleware.ts or devops/docker-compose.ci.yml) and I’ll provide the exact patch + verification commands.

