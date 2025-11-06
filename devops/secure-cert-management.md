# Secure cert management for Kernel mTLS
**Location:** `devops/secure-cert-management.md`  
**Purpose:** document a secure, repeatable approach for generating, injecting, and rotating the CA / server / client certs used by Kernel mTLS in local dev and CI. Explicitly call out the insecure dev-only `chmod 644` hack and provide safe alternatives.

## Goals (short)
- Avoid committing or exposing private keys.
- Make CI reproducible: certs come from repository secrets, not baked into images.
- Enable CI and local runs to trust self-signed certs safely (no `NODE_TLS_REJECT_UNAUTHORIZED=0`).
- Provide a migration path to Docker secrets or Vault for production.

## Files / env variables referenced
- Cert dir (CI/local): `/tmp/illuvrse-certs` (env `ILLUVRSE_CERT_DIR`)
- CI secrets (base64-encoded):
  - `CI_KERNEL_CA`
  - `CI_KERNEL_SERVER_CERT`
  - `CI_KERNEL_SERVER_KEY`
  - `CI_KERNEL_CLIENT_CERT`
  - `CI_KERNEL_CLIENT_KEY`
- CI helper script: `devops/scripts/ci_inject_certs.sh`
- Kernel env to enable test endpoints in CI: `ENABLE_TEST_ENDPOINTS=true`
- Node TLS trust env (preferred): `NODE_EXTRA_CA_CERTS=/tmp/illuvrse-certs/kernel-ca.crt`

## Local dev (recommended)
1. **Generate certs** (example, replace CNs as needed — you already have a script locally; keep CA/private keys out of repo):
   ```bash
   OUT=/tmp/illuvrse-certs
   mkdir -p "$OUT"
   # create CA, server, and client certs (example steps omitted; keep your existing process)

Do NOT permanently chmod 644 private keys in your home. If permissions blocks the container:

Prefer mounting as the same UID/GID the container runs under.

Or run the container with a user that can read the files (best for local dev).

As a true last-resort dev-only temporary step (only on your machine): sudo chmod 644 /tmp/illuvrse-certs/*.key — documented and reversible.

Trust CA when running Node locally:
export NODE_EXTRA_CA_CERTS=/tmp/illuvrse-certs/kernel-ca.crt
# then run tests (no NODE_TLS_REJECT_UNAUTHORIZED=0)
cd kernel
npm ci
npx jest test/integration/auth.integration.test.ts --runInBand --detectOpenHandles

CI: inject certs from secrets (recommended)

Store base64 of each file in repo secrets (exact names above). Use:
base64 kernel-ca.crt | tr -d '\n' > kernel-ca.crt.b64
# then paste contents into GitHub secret CI_KERNEL_CA
Or with gh CLI:
gh secret set CI_KERNEL_CA --repo ILLUVRSE/Main --body "$(cat kernel-ca.crt.b64)"

CI script (devops/scripts/ci_inject_certs.sh) will create /tmp/illuvrse-certs and write files from the secrets. Ensure the workflow sets:

ILLUVRSE_CERT_DIR=/tmp/illuvrse-certs

ENABLE_TEST_ENDPOINTS=true

MTLS_REQUIRE_CLIENT_CERT=false (for CI tests that mix bearer token + client cert)

Trust CA in CI without disabling TLS checks:
Add a step after cert injection and before running tests:
export NODE_EXTRA_CA_CERTS=/tmp/illuvrse-certs/kernel-ca.crt
# run tests without NODE_TLS_REJECT_UNAUTHORIZED=0

If you must accept self-signed certs temporarily, use NODE_TLS_REJECT_UNAUTHORIZED=0 only until this trust step is working; remove it ASAP.

Docker Compose & kernel container (CI/local)

Mount certs into container using ILLUVRSE_CERT_DIR or explicit volume in devops/docker-compose.ci.yml:
services:
  kernel:
    environment:
      - ILLUVRSE_CERT_DIR=/etc/illuvrse/certs
      - MTLS_CERT=/etc/illuvrse/certs/kernel-server.crt
      - MTLS_KEY=/etc/illuvrse/certs/kernel-server.key
      - MTLS_CLIENT_CA=/etc/illuvrse/certs/kernel-ca.crt
      - ENABLE_TEST_ENDPOINTS=true
    volumes:
      - /tmp/illuvrse-certs:/etc/illuvrse/certs:ro

Permissions: For CI runners it’s acceptable for the CI step to chmod 644 the keys because the runner is ephemeral; do not do this for production. Prefer :ro mount and explicit user mapping.

Long-term: Docker secrets or Vault (production)

Docker secrets (Compose v3+):

Create secrets from files (CI or deploy step): docker secret create kernel_server_key ./kernel-server.key

Reference secrets in compose and mount into /run/secrets/.

Kernel must read keys from /run/secrets/kernel_server_key (adjust MTLS_KEY accordingly).

Vault:

Store private keys in Vault (transit/kv), inject at runtime via sidecar or init step.

Prefer short-lived certs and automated rotation.

Recommendation: For Phase 4 CI, keep secrets injected to /tmp/illuvrse-certs via ci_inject_certs.sh. For production, migrate to Vault or Docker secrets.

Rotation and revocation

When rotating certs:

Generate new CA or rotate server cert signed by existing CA.

Update CI secrets with base64-encoded new files.

Update running instances (CI/compose) and verify Kernel HTTPS server listening on port 3000.

Revoke compromised keys immediately and rotate.

Example validation commands (CI/local)

Verify cert files exist:
ls -la /tmp/illuvrse-certs
# expect: kernel-ca.crt kernel-server.crt kernel-server.key kernel-client.crt kernel-client.key
Verify Node trusts the CA:
export NODE_EXTRA_CA_CERTS=/tmp/illuvrse-certs/kernel-ca.crt
node -e "require('https').get('https://localhost:3000',{agent:new (require('https').Agent)({rejectUnauthorized:true})},r=>console.log('OK',r.statusCode)).on('error',e=>console.error('ERR',e.message))"

Expected: connection succeeds when server is up and using server cert signed by kernel-ca.crt.

Verify CI injection (sanity):
# run on Actions runner step: after injection
ls -la /tmp/illuvrse-certs
cat /tmp/illuvrse-certs/kernel-ca.crt | head -n 5

Don’ts / Warnings (blunt)

Do not commit keys/certs anywhere. Ever.

Do not leave NODE_TLS_REJECT_UNAUTHORIZED=0 in CI or prod — it masks real TLS issues.

Do not make private keys world-readable in production.

If you temporarily chmod 644 keys on your dev machine, revert after debugging.

Minimal checklist to wire CI securely (Phase 4)

Add base64 secrets to GitHub (CI_KERNEL_*).

Ensure devops/scripts/ci_inject_certs.sh is executable and used in workflow.

Add export NODE_EXTRA_CA_CERTS=/tmp/illuvrse-certs/kernel-ca.crt step in workflow before running tests.

Mount /tmp/illuvrse-certs into kernel service as read-only and set MTLS_* envs to point at mounted files.

Confirm tests pass without NODE_TLS_REJECT_UNAUTHORIZED=0.

