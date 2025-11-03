# Kernel — Local Development & Quickstart (no sugar)

This file tells you exactly how to get the Kernel running locally for
development and manual verification. Follow the steps **one file at a
time** (we're already following that workflow). Do not commit secrets.

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

````

Edit `kernel/.env` if you want different ports or credentials.

DO NOT put production secrets in the repo. Use Vault/KMS/environment
variables for real deployments. Keep `kernel/.gitignore` in place.

Start local infra

From ILLUVRSE/Main:

### enter repo

```bash
cd ~/ILLUVRSE/Main
```

### start Postgres (and pgadmin if desired)

```bash
docker compose -f kernel/docker-compose.yml up -d db
# optional: docker compose -f kernel/docker-compose.yml up -d
```

### wait for postgres to be ready (psql or wait loop)

### Install and migrate

```bash
cd kernel
npm install
# Run migrations using the included script which calls psql against POSTGRES_URL
export POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/illuvrse
npm run migrate
# Or use the embedded migration runner:
# node -r ts-node/register src/db/index.ts
```

Notes

The migration is idempotent. You should be able to run it repeatedly
without harm. If you run into issues, inspect `kernel/sql/migrations/001_init.sql`.

### Run the server (dev)

**dev (live reload)**

```bash
npm run dev
```

**or build & run**

```bash
npm run build
npm start
```

By default server listens on `PORT=3000`. It will attempt to load
`kernel/openapi.yaml` for request validation. If `KMS_ENDPOINT` is not
set, the server uses a local ephemeral Ed25519 key to sign things
(dev-only; DO NOT use in production).

## Quick manual smoke tests

Replace `localhost:3000` if you configured another port.

### Health

```bash
curl -sS <http://localhost:3000/health> | jq
```

### Security/status

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

## Tests & verification (manual / lightweight)

These manual checks validate core acceptance items without a full CI
setup:

* OpenAPI validation: send an invalid payload (missing required id on
  division) and expect `400` with validation errors (if `openapi.yaml` is
  loaded).

* Signing: `POST /kernel/sign` returns a signature object with `signer_id`
  and `signature`. If `KMS_ENDPOINT` set, the server will call it;
  otherwise local ephemeral signing is used.

* Audit chain: after calling `/kernel/sign` or `/kernel/division`, run
  the psql query above to confirm a new `audit_events` row exists with
  populated `prev_hash`, `hash`, `signature`, `signer_id`, and `ts`.

* DB schema: verify tables exist: `manifest_signatures`, `audit_events`,
  `divisions`, `agents`, `eval_reports`, `memory_nodes`, `resource_allocations`.

* RBAC stubs: inject headers to simulate principals:

  **Human:**
  `-H "x-oidc-sub: user1" -H "x-oidc-roles: SuperAdmin"`

  **Service:**
  `-H "x-service-id: svc1" -H "x-service-roles: Operator"`

Test protected endpoints using these headers.

## Next dev actions (one-file-at-a-time)

When you say done after saving this file, I can provide the next single
file. High-leverage next files to add (pick one):

* `kernel/test/integration/e2e.sh` — a shell script that runs the smoke tests automatically.
* `kernel/src/routes/kernelRoutes.ts` — pull route handlers out of server.ts into a route module.
* `kernel/ci/` files to enforce REQUIRE_KMS in CI.
* Unit tests for `auditStore.computeHash` and `signingProxy.canonicalizePayload`.

## Operational / Security callouts (don’t skip these)

DO NOT COMMIT SECRETS. Use Vault/KMS and environment variables. Keep
`.gitignore` up to date.

KMS/HSM: Replace ephemeral signing with a KMS-backed client for
production. Ensure key rotation is documented and auditable.

Audit integrity: Application must treat `audit_events` as append-only. In
production, enforce immutability at storage level (WORM or managed
append-only sinks).

Sign-off: Kernel cannot be considered live until Ryan (SuperAdmin) and
Security Engineer sign off as per `kernel/acceptance-criteria.md`.

If something fails

* Server errors referencing missing tables -> run migrations (`npm run migrate`) and check `$POSTGRES_URL`.
* OpenAPI validation not running -> confirm `kernel/openapi.yaml` exists and server loaded it (server log message).
* Signature issues -> set `KMS_ENDPOINT` to a mock or implement a KMS proxy; check logs for fallback warnings.

````

