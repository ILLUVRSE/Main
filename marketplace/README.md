# ILLUVRSE — Marketplace

The Marketplace is the customer-facing service for listing signed SKUs, running preview sandboxes, performing checkout, issuing licenses, producing encrypted delivery, and publishing signed delivery proofs tied to Finance ledger proofs and Kernel manifests.

This repository area contains:
- API contract and acceptance tests (`marketplace/api.md`, `marketplace/acceptance-criteria.md`, `marketplace/test/*`)
- Runbooks & production guidance (`marketplace/deployment.md`, `marketplace/docs/PRODUCTION.md`, `marketplace/docs/prd-security.md`)
- A dev-friendly service scaffold, sandbox runner, signer mock, DB schema and CI helpers.

---

## Quick start (local development)

### Prerequisites
- Node.js 18+
- `psql` (Postgres client)
- Docker (for `run-local.sh` which starts Postgres + MinIO)
- Optional: AWS credentials if you want to exercise KMS/S3 in AWS

### 1) Install dependencies
```bash
cd marketplace
npm ci
````

### 2) Start local orchestration (recommended)

`run-local.sh` will start Postgres, MinIO, optional Kernel/Finance/Signer mocks, apply DB migrations, and run the Marketplace server (it expects a dev `npm run dev` script).

```bash
# from repository root or marketplace/
./marketplace/run-local.sh
# To keep the environment running (tails logs)
KEEP_ALIVE=1 ./marketplace/run-local.sh
```

If you prefer to run components manually:

* Start Postgres and create a `marketplace` DB.
* Start MinIO and create buckets `marketplace-artifacts` and `marketplace-audit`.
* Start the signer mock in another terminal:

  ```bash
  node marketplace/mocks/signerMock.js
  ```

### 3) Apply DB migrations

```bash
# If using run-local.sh, migrations may be applied automatically.
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/marketplace ./marketplace/scripts/runMigrations.sh
```

### 4) Seed E2E data (provides `e2e-sku-001`)

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/marketplace ./marketplace/scripts/seed-e2e-data.sh
```

### 5) Run the server locally

```bash
# From marketplace/
npm run dev
# Or run-local.sh will start the service as part of orchestration
```

### 6) Run tests

Unit / contract:

```bash
cd marketplace
npm test        # runs vitest
npm run test:unit
npm run test:contract
```

E2E:

```bash
# Ensure run-local.sh or a running stack is available
npm run test:e2e
# Or run individual tests:
npx vitest run test/e2e/checkout.e2e.test.ts --runInBand
```

Playwright smoke (optional):

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test marketplace/playwright/smoke.spec.ts
```

---

## Key files & folders

* `marketplace/api.md` — API contract (catalog, preview, checkout, finalize, license verification, proofs).
* `marketplace/acceptance-criteria.md` — final gates required for production acceptance.
* `marketplace/run-local.sh` — local orchestration (Postgres, MinIO, mocks, marketplace).
* `marketplace/sql/migrations/` — DB migrations (initial schema `0001_init.sql`).
* `marketplace/scripts/*` — migration and seed helpers.
* `marketplace/server/` — TypeScript server code (routes, libs, clients).
* `marketplace/sandbox/sandboxRunner.ts` — preview sandbox runner (unit-tested).
* `marketplace/mocks/signerMock.js` — signing proxy mock for local dev.
* `marketplace/test/e2e` & `marketplace/test/unit` — acceptance and unit tests.
* `marketplace/docs/*` — deployment, production and security runbooks.

---

## Security & production notes (summary)

* **Do not** commit private keys or secrets. Use Vault / Secret Manager. See `scripts/ci/check-no-private-keys.sh` used in CI.
* Production must enforce KMS or signing-proxy (`REQUIRE_KMS=true` or `REQUIRE_SIGNING_PROXY=true`) and use mTLS for Kernel/Finance. See `marketplace/docs/prd-security.md`.
* Audit events must be exported to an S3 audit bucket with Object Lock enabled. See `marketplace/deployment.md` and `marketplace/docs/PRODUCTION.md`.
* Encrypted delivery should prefer buyer-managed keys (privacy) or an HSM-managed ephemeral key. See `marketplace/server/lib/delivery.ts`.

---

## CI

The repo includes `.github/workflows/marketplace-ci.yml` which runs:

* Unit & contract tests
* E2E (checkout + signedProofs) using `run-local.sh`
* Audit verification (best-effort)

CI verifies signing path for protected branches using the `require-signing-check` job.

---

## Troubleshooting

* If run-local fails to start, check logs at `/tmp/marketplace_run_local.log` or the PID files created under `/tmp`.
* If tests fail due to signing or KMS, ensure the signer mock is running or configure `AUDIT_SIGNING_KMS_KEY_ID` and `SIGNING_PROXY_URL`.
* If audit export fails, confirm `S3_AUDIT_BUCKET` is configured and Object Lock is enabled.

---

## Contributing

Follow the repository-level `CONTRIBUTING.md`. For Marketplace-specific PRs:

* Update `marketplace/acceptance-criteria.md` if adding new blocking flows.
* Add/adjust contract tests under `marketplace/test/contract`.
* Ensure `marketplace/.github/workflows/marketplace-ci.yml` remains green.

---

## Contact / Sign-offs

Final approver: **Ryan (SuperAdmin)**. Security and Finance sign-offs are required before production enablement (placeholders in `marketplace/signoffs/`).

```
