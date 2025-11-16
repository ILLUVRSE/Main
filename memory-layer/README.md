# Memory Layer — Local Development, Testing, and Operations

This README explains how to run, test, and operate the Memory Layer locally and in CI. It summarizes all core commands and environment variables required by the service.

> **Note:** This module is part of the ILLUVRSE monorepo. Many scripts assume you run them either from the repository root or from the `memory-layer` subdirectory.

---

## Quick Start (Local Development)

### Prerequisites

* Node 18+
* Docker (used for Postgres)
* `npx` and `ts-node` installed (via `npm install`)

### Start Local Postgres

```bash
docker run -d --name illuvrse-postgres \
  -e POSTGRES_USER=illuvrse \
  -e POSTGRES_PASSWORD=illuvrse_pass \
  -e POSTGRES_DB=illuvrse_memory \
  -p 5432:5432 \
  postgres:14
```

### Install Dependencies

From the repo root:

```bash
npm ci
```

### Run Migrations

```bash
DATABASE_URL=postgres://illuvrse:illuvrse_pass@localhost:5432/illuvrse_memory \
  npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations
```

### Start the Service (Dev)

```bash
DATABASE_URL=postgres://illuvrse:illuvrse_pass@localhost:5432/illuvrse_memory \
PORT=4300 \
NODE_ENV=development \
npx ts-node memory-layer/service/server.ts
```

### Optional: Vector Worker & TTL Cleaner

```bash
# Vector worker
npx ts-node memory-layer/service/worker/vectorWorker.ts

# TTL cleaner
npx ts-node memory-layer/service/jobs/ttlCleaner.ts
```

---

## Integration Tests

Integration tests require a running Postgres instance reachable via `DATABASE_URL`.

```bash
# ensure Postgres + migrations
DATABASE_URL=postgres://illuvrse:illuvrse_pass@localhost:5432/illuvrse_memory \
npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations

# run integration tests
npm run test:integration --prefix memory-layer
# or
npm run memory-layer:test:integration
```

CI environments can use `memory-layer/service/audit/ci-env-setup.sh`, which boots a local signing‑proxy mock and sets `AUDIT_SIGNING_KEY` / `SIGNING_PROXY_URL` to support audit signing in tests.

---

## Audit & Signing

* Production must use KMS (`AUDIT_SIGNING_KMS_KEY_ID`) or a secure signing proxy (`SIGNING_PROXY_URL`).
* Local dev / CI may use `AUDIT_SIGNING_KEY` or the included mock signer.
* `REQUIRE_KMS=true` or `NODE_ENV=production` blocks startup unless a signer is configured.

### Tools

* `memory-layer/tools/auditReplay.ts` — replay archived audit JSON into Postgres.
* `memory-layer/service/audit/verifyTool.ts` — verify audit chain & signatures.
* `memory-layer/service/audit/archiver.ts` — export audit batches to S3 with object‑lock.

---

## Vector DB

* Default dev provider is Postgres (stores JSON vector data in `memory_vectors`).
* Production should use an ANN provider (pgvector, Milvus, Pinecone).
* Configure via: `VECTOR_DB_PROVIDER`, `VECTOR_DB_ENDPOINT`, `VECTOR_DB_API_KEY`.
* `VECTOR_WRITE_QUEUE=true` enables queue fallback when external writes fail.

---

## Key Environment Variables

* `DATABASE_URL` — Postgres connection string
* `NODE_ENV` — `development` or `production`
* `REQUIRE_KMS` — require signer at startup
* `AUDIT_SIGNING_KMS_KEY_ID`, `AUDIT_SIGNING_ALG`
* `SIGNING_PROXY_URL`, `SIGNING_PROXY_API_KEY`
* `AUDIT_SIGNING_KEY` / `MOCK_AUDIT_SIGNING_KEY`
* `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET`
* `VECTOR_DB_PROVIDER`, `VECTOR_DB_ENDPOINT`, `VECTOR_DB_API_KEY`, `VECTOR_WRITE_QUEUE`

---

## CI Workflow

The GitHub Actions workflow (`.github/workflows/memory-layer-ci.yml`) performs:

1. Boots a Postgres 14 service container
2. Installs dependencies
3. Builds TypeScript (`npm run memory-layer:build`)
4. Runs DB migrations
5. Executes integration tests
6. Runs audit verification

---

## Operational Notes

* See `memory-layer/docs/runbook_signing.md` for signing/KMS operations.
* See `memory-layer/deployment.md` for deployment & DR procedures.
* Production requires `AUDIT_SIGNING_KMS_KEY_ID` or a valid signer configuration.

---

## Next Steps / TODO

* Replace mock signer with real KMS or signing proxy in staging/prod.
* Migrate vector adapter to a production ANN provider.
* Align `@types/express` versions and remove remaining `as any` casts.
* Complete CI secret handling via Vault.

