# Kernel — Local Development & Quickstart (no sugar)

This file tells you how to get the Kernel running locally for development
and manual verification. Work one file at a time. Do not commit secrets.

---

## Prereqs (you already have most files)

* `kernel/openapi.yaml`, `kernel/data-models.md`,
  `kernel/acceptance-criteria.md` exist in the repo (these are the
  contract and doc sources).
* Files created so far: `src/server.ts`, `src/db/index.ts`,
  `src/signingProxy.ts`, `src/auditStore.ts`, `src/rbac.ts`,
  `src/models.ts`, `src/types.ts`, `src/sentinelClient.ts`,
  `sql/migrations/001_init.sql`, `package.json`, `tsconfig.json`,
  `env.sample`, `docker-compose.yml`, `.gitignore`.

If any of those are missing, stop and create them now (one file at a
time). Don’t guess.

---

## Environment (local dev)

1. Copy env sample:

```bash
cp kernel/env.sample kernel/.env
```

Edit `kernel/.env` if you want different ports or credentials.

Do not put production secrets in the repo. Use Vault/KMS or environment
variables for real deployments. Keep `kernel/.gitignore` in place.

---

## Start local infra (from repo root)

Enter the repo:

```bash
cd ~/ILLUVRSE/Main
```

Start Postgres (and pgAdmin if desired):

```bash
docker compose -f kernel/docker-compose.yml up -d db
# optional: docker compose -f kernel/docker-compose.yml up -d
```

Wait for Postgres to be ready (psql or a wait loop).

Install dependencies and run migrations:

```bash
cd kernel
npm install

# Run migrations using the included script which calls psql against POSTGRES_URL
export POSTGRES_URL="postgresql://postgres:postgres@localhost:5432/illuvrse"
npm run migrate

# Or use the embedded migration runner:
# node -r ts-node/register src/db/index.ts
```

Notes: the migration is idempotent. If you run into issues, inspect
`kernel/sql/migrations/001_init.sql`.

---

## Run the server (dev)

**Dev (live reload)**

```bash
npm run dev
```

**Build & run**

```bash
npm run build
npm start
```

By default the server listens on `PORT=3000`. It attempts to load
`kernel/openapi.yaml` for request validation. If `KMS_ENDPOINT` is not
set the server uses a local ephemeral Ed25519 key for dev-only signing
(never use this in production).

---

## Quick manual smoke tests

Replace `localhost:3000` if you configured another port.

### Health

```bash
curl -sS <http://localhost:3000/health> | jq
```

### Security / status

```bash
curl -sS <http://localhost:3000/kernel/security/status> | jq
```

### Sign a manifest

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"manifest":{"id":"dvg-test-1","name":"Test Division","goals":["ship"],"budget":1000,"kpis":["k1"],"policies":[]}}' \
  <http://localhost:3000/kernel/sign> | jq
```

### Create (upsert) a Division

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"id":"dvg-test-1","name":"Test Division","goals":["ship"],"budget":1000,"currency":"USD","kpis":["k1"],"policies":[]}' \
  <http://localhost:3000/kernel/division> | jq
```

### Fetch division

```bash
curl -sS <http://localhost:3000/kernel/division/dvg-test-1> | jq
```

### Submit an eval

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"agent_id":"agent-1","metric_set":{"taskSuccess":0.9},"computedScore":0.9}' \
  <http://localhost:3000/kernel/eval> | jq
```

### Inspect audit events (psql)

```bash
psql "$POSTGRES_URL" -c "SELECT id,event_type,ts FROM audit_events ORDER BY ts DESC LIMIT 10;"
```

---

## Tests & verification (manual / lightweight)

These manual checks validate core acceptance items without full CI:

* **OpenAPI validation** — send an invalid payload (missing required
  `id` on division) and expect `400` with validation errors if
  `openapi.yaml` is loaded.

* **Signing** — `POST /kernel/sign` returns a signature object with
  `signer_id` and `signature`; if `KMS_ENDPOINT` is set the server will
  call it, otherwise local ephemeral signing is used.

* **Audit chain** — after calling `/kernel/sign` or `/kernel/division`,
  run the psql query above to confirm a new `audit_events` row exists
  with `prev_hash`, `hash`, `signature`, `signer_id`, and `ts`.

* **DB schema** — verify tables exist: `manifest_signatures`,
  `audit_events`, `divisions`, `agents`, `eval_reports`, `memory_nodes`,
  `resource_allocations`.

* **RBAC stubs** — inject headers to simulate principals:

  **Human**

  ```text
  -H "x-oidc-sub: user1" -H "x-oidc-roles: SuperAdmin"
  ```

  **Service**

  ```text
  -H "x-service-id: svc1" -H "x-service-roles: Operator"
  ```

Test protected endpoints using these headers.

---

## Next dev actions (one-file-at-a-time)

High-leverage next files to add (pick one):

* `kernel/test/integration/e2e.sh` — shell script to run smoke tests.
* `kernel/src/routes/kernelRoutes.ts` — move route handlers into a module.
* `kernel/ci/` files to enforce REQUIRE_KMS in CI.
* Unit tests for `auditStore.computeHash` and `signingProxy.canonicalizePayload`.

---

## Operational / security callouts

Do not commit secrets. Use Vault/KMS and environment injection.
Replace ephemeral dev signing with a KMS-backed client in production.
Record key rotation in audit logs. Treat `audit_events` as append-only.

Sign-off: Kernel cannot be considered live until Ryan (SuperAdmin) and
Security sign off per `kernel/acceptance-criteria.md`.

If something fails:

* Server errors referencing missing tables → run migrations (`npm run migrate`) and check `$POSTGRES_URL`.
* OpenAPI validation not running → confirm `kernel/openapi.yaml` exists.
* Signature issues → set `KMS_ENDPOINT` to a mock or implement a KMS proxy; check logs for fallback warnings.

