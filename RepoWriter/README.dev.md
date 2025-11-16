# RepoWriter — Local Development & Runbook

This document explains how to run, test, and develop **RepoWriter** locally, and how to run it in production. It documents the canonical server boot, signing/KMS configuration, startup checks, and CI.

---

## Table of contents

* [Quickstart (dev)](#quickstart-dev)
* [Environment variables (.env)](#environment-variables-repowriterserverenv)
* [Canonical server bootstrap](#canonical-server-bootstrap)
* [Signing / KMS (summary)](#signing--kms-summary)
* [Startup checks](#startup-checks)
* [Tests & CI](#tests--ci)
* [Troubleshooting](#troubleshooting)
* [Production checklist](#production-checklist-short)
* [Notes about artifact-publisher compatibility](#notes-about-artifact-publisher-compatibility)
* [Dev tips](#dev-tips)

---

## Quickstart (dev)

1. Copy example env:

   ```bash
   cp RepoWriter/server/.env.example RepoWriter/server/.env
   # Edit RepoWriter/server/.env and set REPO_PATH to a reachable repo for local testing.
   ```

2. Install dependencies:

   ```bash
   npm --prefix RepoWriter/server ci
   ```

3. For local development (run TS directly with hot reload):

   ```bash
   # dev: uses nodemon and ts-node loader (fast iteration)
   npm --prefix RepoWriter/server run dev
   # This runs the TypeScript source at RepoWriter/server/src/index.ts via ts-node.
   ```

4. For a production-style run (build + run compiled JS):

   ```bash
   # build (compiles to RepoWriter/server/dist)
   npm --prefix RepoWriter/server run build

   # run compiled server (recommended for production)
   npm --prefix RepoWriter/server start
   # 'start' runs: node dist/index.js
   ```

5. Health check (after startup):

   ```bash
   # server exposes either /api/health or /health depending on your configuration
   curl -fsS http://localhost:7071/api/health || curl -fsS http://localhost:7071/health
   ```

---

## Environment variables (RepoWriter/server/.env)

The example file `RepoWriter/server/.env.example` contains full details. Key variables you must set for dev and production:

* `PORT` — server port (default 7071).
* `REPO_PATH` — absolute path to repo root the server will operate on.
* **OpenAI:**

  * `OPENAI_API_KEY` or `OPENAI_API_URL` for a mock.
  * `REPOWRITER_ALLOW_NO_KEY` and `SANDBOX_ENABLED` are dev conveniences.
* **Signing / KMS (Task 1):**

  * `REPOWRITER_SIGNING_SECRET` — dev HMAC fallback (do not use in prod).
  * `SIGNING_PROXY_URL` — production signing proxy (e.g., `https://signer.prod.internal`).
  * `SIGNING_PROXY_API_KEY` — optional bearer token.
  * `REQUIRE_SIGNING_PROXY` — if `1`, production will fail if the signing proxy fails or returns invalid responses.
* **Logging / telemetry:**

  * `LOG_LEVEL`, `TELEMETRY_ENDPOINT`.

> **Important:** Never commit `RepoWriter/server/.env` with secrets.

---

## Canonical server bootstrap

The canonical server entrypoint is `RepoWriter/server/index.js`:

* It prefers a compiled artifact at `RepoWriter/server/dist/index.js` (production).
* If no compiled dist exists it will attempt to run the TypeScript source `RepoWriter/server/src/index.ts` using `ts-node` (development).
* Only if neither path is available it falls back — with a warning — to the `artifact-publisher` compatibility artifact (temporary behavior during migration).

**Production recommendation:** Build (`npm run build`) and run the compiled JS (`npm start`).

---

## Signing / KMS (summary)

RepoWriter prefers signing via a signing-proxy backed by KMS/HSM:

* **Proxy contract:**

  * `POST ${SIGNING_PROXY_URL}/sign` with `{ payload_b64 }`
  * Response: `{ signature_b64, signer_id }`
* If `REQUIRE_SIGNING_PROXY=1` in production, RepoWriter **fails closed** if the proxy fails or the response is invalid.
* Dev/CI fallback: deterministic HMAC signer using `REPOWRITER_SIGNING_SECRET`.

See `RepoWriter/docs/signing.md` for full details.

---

## Startup checks

`RepoWriter/server/src/startupCheck.ts` runs before the server binds:

* Ensures `REPO_PATH` is readable/writable.
* If `NODE_ENV=production` and `REQUIRE_SIGNING_PROXY=1`, ensures `SIGNING_PROXY_URL` is configured.
* If `SIGNING_PROXY_URL` is set, verifies `global.fetch` exists (Node 18+ or polyfill).
* Warns if production lacks OpenAI config.

The server entrypoint calls `runStartupChecks()` before starting.

---

## Tests & CI

* Unit tests:

  ```bash
  npm --prefix RepoWriter/server run test
  ```

  (uses Vitest).

* Type checking:

  ```bash
  npm --prefix RepoWriter/server exec -- tsc -p tsconfig.json --noEmit
  ```

* Build:

  ```bash
  npm --prefix RepoWriter/server run build
  ```

**CI:** A GitHub Actions workflow `/.github/workflows/repowriter-ci.yml` builds, typechecks, runs tests, and does a short startup smoke test. The repository also contains the previous `artifact-publisher` CI; RepoWriter has its own CI workflow now.

---

## Troubleshooting

* `Startup checks failed: Global 'fetch' is not available...` — upgrade Node to 18+ or polyfill `fetch` before startup:

  ```js
  // e.g. in the very first line of your boot script for Node <18:
  import { fetch } from 'undici';
  globalThis.fetch = fetch;
  ```

* Signing errors: check `SIGNING_PROXY_URL` and `SIGNING_PROXY_API_KEY` connectivity; for dev set `REQUIRE_SIGNING_PROXY=0` to allow HMAC fallback (not for production).

* If you see `FATAL: cannot find a runnable server` ensure you built `dist/` or installed `ts-node` for dev.

---

## Production checklist (short)

1. Provision signing-proxy backed by KMS/HSM.

2. Configure production secrets:

   * `NODE_ENV=production`
   * `SIGNING_PROXY_URL=https://signer.prod.internal`
   * `SIGNING_PROXY_API_KEY=<secret>`
   * `REQUIRE_SIGNING_PROXY=1`
   * `REPO_PATH` (absolute path)
   * Telemetry and logging endpoints

3. Build and deploy:

   ```bash
   npm --prefix RepoWriter/server ci
   npm --prefix RepoWriter/server run build
   node RepoWriter/server/dist/index.js
   ```

4. Run acceptance job (smoke + e2e) in CI.

5. Obtain Security + Finance + Ryan sign-off.

---

## Notes about artifact-publisher compatibility

* The repo previously exported `artifact-publisher` as the canonical server. The new `RepoWriter/server/index.js` replaces the deprecation shim and prefers local/dist server. If you depend on `artifact-publisher` behavior, verify parity (routing, env) and migrate any glue code to RepoWriter in this repo.

---

## Dev tips

* Use the local OpenAI mock for iteration: set `OPENAI_API_URL` to your mock or enable `SANDBOX_ENABLED=1`.
* To run a signing-proxy mock for local end-to-end tests, point `SIGNING_PROXY_URL` to a simple HTTP mock that returns the expected JSON shape — a mock script for CI/dev can be added.
* Keep `REPO_PATH` pointing to a disposable git repo for local tests.

