# Kernel — Production Deployment Runbook (concise, no fluff)

Purpose
-------
Clear, actionable steps to deploy the ILLUVRSE Kernel as a production container and bring it live. This runbook assumes you will run the Kernel as a long-running container (Docker) on a host like Fly.io / Render / DigitalOcean / ECS. It does **not** advise running on Vercel for production.

Always: **DO NOT COMMIT SECRETS**. Use host secret management (Fly secrets, Render secrets, GitHub Actions secrets, Vault).

Prereqs
-------
- Code on `main` contains:
  - `kernel/dist` (built JS), `kernel/Dockerfile`, `kernel/entrypoint.sh`, `kernel/sql/migrations/*`.
  - `kernel/PRODUCTION.md`, `kernel/env.prod.sample`.
- An accessible managed Postgres instance (hosted, TLS enabled).
- A production KMS / signing proxy that implements the signing contract (Ed25519).
- Fly/Render/AWS account and CLI (`flyctl`, `render` or `aws` CLI + deploy tool).
- CI credentials (container registry or Fly API token) in CI secrets.

Required production environment variables (examples)
---------------------------------------------------
Set these as secrets on the host and in CI. Do NOT store plaintext in repo.

- `POSTGRES_URL`
  Example: `postgresql://user:password@db.prod.example:5432/illuvrse?sslmode=require`

- `KMS_ENDPOINT`
  Example: `https://kms.internal/sign` (must support manifest sign and signData endpoints used by `signingProxy`)

- `SIGNER_ID`
  KMS key identifier (string). Example: `kernel-signer-1`

- `REQUIRE_KMS=true`
  Enforced in CI for prod pushes.

- `NODE_ENV=production`, `PORT=3000`, `LOG_LEVEL=info`

Host-specific secrets (examples)
- `FLY_API_TOKEN` or `DOCKERHUB_*` (for CI deploy)
- `SENTRY_DSN` (optional)

High-level deployment steps (one-shot)
-------------------------------------
1. **Build & test locally**
   - From `ILLUVRSE/Main/kernel`:
     ```bash
     npm ci
     npm run build
     ./scripts/run-migrations.sh   # against dev/test DB
     docker build -t illuvrse-kernel:local -f kernel/Dockerfile kernel
     docker run --rm -e POSTGRES_URL=... -p 3000:3000 illuvrse-kernel:local
     curl http://localhost:3000/health
     ./test/integration/e2e.sh
     ```
   - Fix issues until e2e passes.

2. **Provision production Postgres**
   - Use a managed DB (Supabase, RDS, ElephantSQL, DigitalOcean Managed DB). Enable TLS and network controls.
   - Create DB `illuvrse` and a service account for the Kernel with least privilege.

3. **Set host secrets**
   - Example Fly.io:
     ```bash
     flyctl secrets set POSTGRES_URL="postgresql://..." KMS_ENDPOINT="https://kms..." SIGNER_ID="kernel-signer-1"
     ```
   - Or in Render / DO / GitHub Actions secrets for CI.

4. **Migrate production DB**
   - Run migrations once using CI job or run directly from a safe admin host:
     ```bash
     psql "$POSTGRES_URL" -f kernel/sql/migrations/001_init.sql
     # or run the compiled runner on the container host:
     docker run --rm -e POSTGRES_URL="$POSTGRES_URL" illuvrse-kernel:local node ./dist/db/index.js
     ```

5. **Deploy container**
   - **Fly.io (recommended quick flow):**
     ```bash
     flyctl auth login
     flyctl apps create illuvrse-kernel --org <org> --region iad
     flyctl secrets set POSTGRES_URL="$POSTGRES_URL" KMS_ENDPOINT="$KMS_ENDPOINT" SIGNER_ID="$SIGNER_ID"
     flyctl deploy --config fly.toml
     flyctl logs --app illuvrse-kernel   # watch startup
     ```
   - **Render / DO / ECS**: create a Web Service pointing to the Dockerfile, set env vars via UI, deploy.
   - Validate health: `curl -sS https://<app-host>/health`

6. **Smoke test production**
   - Run the same smoke tests as local but target the production domain:
     ```bash
     POSTGRES_URL="$POSTGRES_URL" PORT=3000 ./kernel/test/integration/e2e.sh
     ```
   - Verify `audit_events` and `manifest_signatures` contain production rows.

Security & operations checklist (must pass)
-------------------------------------------
- [ ] **KMS in place**: `KMS_ENDPOINT` points to a production KMS signed by your security team. No local ephemeral keys in prod.
- [ ] **Signing verification**: Verifier can validate Ed25519 signatures returned by `/kernel/sign` using the public key from KMS. Run verification test vector.
- [ ] **Audit chain**: Chain integrity check passes end-to-end (create 10 audit events, verify `prev_hash` links and signature validation).
- [ ] **RBAC**: Critical endpoints enforce roles:
  - `POST /kernel/division`: `DivisionLead | SuperAdmin`
  - `POST /kernel/sign`: `SuperAdmin | Service`
  - `GET /kernel/audit/{id}`: `Auditor | SuperAdmin`
  - `POST /kernel/allocate`: `Operator | DivisionLead | SuperAdmin`
- [ ] **Sentinel policy**: `enforcePolicyOrThrow` integrated for manifests & allocations; policy decisions recorded in audit logs.
- [ ] **Secrets**: No secrets in repo; secrets exist only in host secret manager.
- [ ] **Backups**: Postgres backups configured (daily snapshot with 30/90-day retention).
- [ ] **Monitoring & alerting**: Metrics exported (sign ops/sec, audit latency, request p95/p99), alerts on key errors.
- [ ] **CI gating**: Merging to `main` requires CI green and `REQUIRE_KMS` enforced for production.

Key rotation & compromise (summary)
-----------------------------------
- Keys are hosted in KMS/HSM. Rotate keys via KMS rotation API.
- Rotation workflow (short):
  1. Create new key in KMS (`key-v2`), publish public key.
  2. Update `SIGNER_ID` to reference `key-v2` in a staging Kernel, sign a rotation audit event with both old and new signer IDs.
  3. Emit audit `upgrade.applied` once 3-of-5 multisig checklist passes.
  4. Retire old key in KMS after overlap period. Document exact steps in `kernel/security-governance.md`.

Rollback plan
-------------
- Keep DB migrations backward-compatible when possible. For risky migrations:
  - Deploy schema change behind feature flag, or
  - Use write-forward pattern (create new table, backfill, switch reads).
- On catastrophic failure, roll back to previous container image and restore DB snapshot.

Troubleshooting quick hits
--------------------------
- **Server never starts**: Check host logs, confirm `POSTGRES_URL` reachable and `KMS_ENDPOINT` if `REQUIRE_KMS=true`.
- **Migration fails**: inspect SQL line, run migration locally against a copy of prod DB, fix idempotency.
- **Audit chain missing fields**: verify `audit_events` columns exist and `appendAuditEvent` uses UUID ids (no prefix).
- **Signatures invalid**: retrieve public key from KMS and verify Ed25519 signature of canonicalized payload.

Appendix: Minimal commands
---------------------------
```bash
# Build + run image locally (dev)
docker build -t illuvrse-kernel:local -f kernel/Dockerfile kernel
# ensure DB running locally
docker run -d --name pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=illuvrse -p 5432:5432 postgres:15
# run migrations (host psql or inside container)
docker run --rm -e POSTGRES_URL="postgresql://postgres:postgres@host.docker.internal:5432/illuvrse" illuvrse-kernel:local node ./dist/db/index.js
# run container
docker run --rm -e POSTGRES_URL="postgresql://postgres:postgres@host.docker.internal:5432/illuvrse" -e KMS_ENDPOINT="" -p 3000:3000 illuvrse-kernel:local
# health
curl http://localhost:3000/health

Acceptance criteria (short)

curl https://<prod-host>/health → {"status":"ok","ts":"..."}

E2E smoke tests pass against prod host.

Audit events and manifest_signatures appear and verify with KMS public key.

Security checklist signed by Ryan (SuperAdmin) and Security Engineer.

