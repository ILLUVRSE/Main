# Memory Layer Contribution Guide

## Quick Prerequisites (Local)

* Node 18+
* Docker (for Postgres in tests)
* `npx` available
* Run `npm ci` from repo root to install dependencies
* `ts-node` and `jest` available via `npm` scripts

Run once from the repository root:

```bash
npm ci
```

---

## Branch & Commit Workflow

1. Create a topic branch from `main`:

   ```bash
   git checkout -b memory-layer/<short-topic>
   ```

2. Make small, focused commits with imperative, concise messages:

   ```
   memory-layer: fix audit signing param handling
   memory-layer: add ttlCleaner batch logging
   memory-layer: migrate s3 client to aws-sdk v3
   ```

3. Run all local checks before pushing.

---

## Local Checks — Required Before Pushing

### 1. Type-check / Build

From repo root:

```bash
npm run memory-layer:build
```

This runs `tsc` and must pass cleanly.

### 2. Unit / Integration Tests (Requires Postgres)

Start local Postgres if not running:

```bash
docker run -d --name illuvrse-postgres \
  -e POSTGRES_USER=illuvrse \
  -e POSTGRES_PASSWORD=illuvrse_pass \
  -e POSTGRES_DB=illuvrse_memory \
  -p 5432:5432 \
  postgres:14
```

Apply migrations:

```bash
DATABASE_URL=postgres://illuvrse:illuvrse_pass@localhost:5432/illuvrse_memory \
  npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations
```

Run integration tests:

```bash
npm run memory-layer:test:integration
```

If signing is required during tests, use:

```
memory-layer/service/audit/ci-env-setup.sh
```

to start a mock signer and set `AUDIT_SIGNING_KEY` or `SIGNING_PROXY_URL`.

### 3. Lint

```bash
npm run lint
```

Fix all warnings/errors. Avoid `any` in final PRs.

### 4. Manual Runtime Smoke Test

Start the server:

```bash
DATABASE_URL=postgres://illuvrse:illuvrse_pass@localhost:5432/illuvrse_memory PORT=4300 \
  npx ts-node memory-layer/service/server.ts
```

In a second terminal:

```bash
curl -i http://localhost:4300/healthz
```

---

## Jest / Test Guidance

* Uses `ts-jest` (see `jest.config.js`).
* Integration tests live under `memory-layer/test/integration`.
* May require mock signer or `AUDIT_SIGNING_KEY`.
* Keep tests hermetic, deterministic, and isolated.
* Use `FOR UPDATE SKIP LOCKED` when appropriate.

---

## Coding Standards

* TypeScript strict mode is enabled. Avoid `any` unless justified with comments.
* Follow ESLint rules defined in `.eslintrc.js`.
* Update API docs (`memory-layer/acceptance-criteria.md`, `memory-layer/README.md`) when behavior changes.
* Never commit secrets; rely on env variables and CI secrets.

---

## Auditing, Signing & Security

* Production **must not start** without a signer when `NODE_ENV=production` or `REQUIRE_KMS=true`.
* Tests/CI should use mock signer or `AUDIT_SIGNING_KEY`.
* Any change affecting audit or signing must include:

  * Canonicalization + digest tests
  * Verification path tests (mock + KMS if possible)
* Security-sensitive changes (KMS/HSM, multisig, audit archive) require Security Engineer review and signed audit sign-off.

---

## CI & PR Expectations

* Open PRs from topic branches only.
* PR must pass the full `memory-layer CI` workflow:

  * `npm ci`
  * `memory-layer:build`
  * `runMigrations`
  * `memory-layer:test:integration`
  * `memory-layer:verify`
* All reviews and CI checks must pass before merging.

---

## Database & Migrations

* Use `memory-layer/scripts/runMigrations.ts` for migrations.
* Add SQL files under `memory-layer/sql/migrations`.
* Migrations must be idempotent and tracked via `schema_migrations`.
* Add migration tests when relevant and update deployment documentation.

---

## Vector / Embeddings

* Vector writes must be idempotent.
* Writes to `memory_vectors` must maintain `(memory_node_id, namespace)` uniqueness.
* External vector providers must support fallback queueing via `VECTOR_WRITE_QUEUE=true`.
* Vector search may be brute-force in dev but must use ANN in production.

---

## Documentation & Runbooks

* Update `memory-layer/deployment.md` and `memory-layer/docs/runbook_signing.md` when operational behavior changes.
* Update acceptance criteria (`memory-layer/acceptance-criteria.md`) with new or removed features.

---

## Release / Final Sign-off

1. Ensure all acceptance criteria are met.
2. Security Engineer completes signoff on KMS/HSM, signing proxy, object-lock, and PII.
3. Final approver (Ryan) records sign-off as a signed audit event including PR/commit ID and checklist reference.

---

## When in Doubt

* Keep pull requests focused and small.
* Add tests for changes involving signing, auditing, or DB transaction boundaries.
* Request a review and provide steps to reproduce any non-obvious behavior.

