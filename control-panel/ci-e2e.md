# Control-Panel — Playwright CI & E2E Plan

**Purpose**
How to run Control-Panel end-to-end tests (Playwright) in CI and locally. This file explains environment requirements, test setup (mocks vs staging), CI workflow example, artifacts, flaky-test handling, and verification requirements for PR gating.

**Audience:** SRE / CI Authors / Frontend Engineers / QA

---

## Goals

* Provide deterministic, reproducible E2E runs that exercise critical operator flows:

  * Authentication & RBAC
  * Upgrade approval → apply (multisig)
  * Emergency ratification & rollback
  * SentinelNet verdict rendering
  * Reasoning Graph trace review & annotations
  * Audit explorer search and verification
* Support **mocked** local/CI runs and **staging** runs (real services).
* Fail PRs when critical flows break; upload artifacts on failures.

---

## Quick run (local, mock Kernel)

From `control-panel/`:

```bash
# 1. install
cd control-panel
npm ci

# 2. Start development server (demo mode or with real/stubbed Kernel)
cp .env.example .env.local
# If running with mock Kernel, ensure PLAYWRIGHT_MOCK_SERVER=true or use start-mocks script
export PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000
npm run dev &

# 3. Run Playwright tests (default: headless chromium)
npx playwright test --project=chromium --reporter=list

# To run a single test file:
npx playwright test e2e/upgrade-approval.spec.ts --project=chromium --debug
```

---

## Required environment variables

Set these in CI (or `.env.local` for local runs). For mock-mode some can be omitted.

**Core**

* `PLAYWRIGHT_BASE_URL` — base URL of the Control-Panel under test (e.g., `http://127.0.0.1:3000`)
* `PLAYWRIGHT_TEST_MODE` — `mock` or `staging` (default: `mock`)
* `NODE_ENV=development` or `test`

**Mock-related**

* `PLAYWRIGHT_MOCK_KERNEL=true` — when set, tests instruct the app to expect in-test route mocks (recommended for CI speed).
* `PLAYWRIGHT_MOCK_SIGNER=true` — stub signing behavior for tests.

**Staging-run variables (when running against staging)**

* `PLAYWRIGHT_OIDC_TEST_USER` — test user credentials or token provider (only for staging if automated login is supported)
* `PLAYWRIGHT_ADMIN_TOKEN` — admin token for backend proxy tests (store securely in CI secrets)
* `PLAYWRIGHT_WAIT_FOR_SERVICES=true` — allow tests to wait and probe dependent services

**Secrets**

* Any real secrets (OIDC client secret, kernel token) must live in CI secret store and **never** be printed in logs or committed.

---

## Mocks vs staging

**Mock mode (recommended for PR CI)**

* Playwright tests mock backend endpoints inside the test (`page.route`) or by starting a lightweight mock server (`control-panel/test/mocks/*`) that implements:

  * `/api/session`
  * `/api/kernel/*` endpoints used by the UI
  * `/api/signing/*` endpoints for signing flows
* Pros: deterministic, fast, runs offline.

**Staging mode (optional)**

* Run E2E against a staging stack with Kernel, SentinelNet, and Reasoning Graph running. Requirements:

  * Staging services must be API-compatible and seeded with a test workspace/upgrade.
  * Authentication: tests must obtain a short-lived test token (OIDC test client) or use test cookie injection.
  * Use `PLAYWRIGHT_TEST_MODE=staging` and set the staging env vars in CI.

---

## Playwright configuration recommendations

* Use `playwright.config.ts` tuned for CI:

  * `expect` timeouts: `10_000` ms for visibility checks; `30_000` for network-heavy flows.
  * Run `chromium` headless as primary project. Optionally add `webkit`/`firefox` for cross-browser sanity.
  * `retries` set to `1` for CI flakiness mitigation, but failing tests after retry must still fail the job.
  * Capture trace on first retry and video on all runs for debugging:

    ```ts
    use: {
      trace: 'on-first-retry',
      video: 'on',
      screenshot: 'only-on-failure'
    }
    ```
* Tag critical tests with `@critical` and run those for PR gating; run full suite nightly.

---

## Test design & best practices

* **Deterministic test data:** tests should create their own test objects (upgrades, demo agents) and clean up. Avoid depending on pre-existing random data.
* **One flow per test file:** keep tests focused (approval flow, emergency ratify, audit explorer). Use `beforeEach` to seed state.
* **Mock kernel when possible:** for approval/apply flow use in-test mocks so execution does not rely on external infra.
* **Server-side token checks:** ensure test asserts Kernel proxy does not expose server tokens to client responses.
* **Audit verification:** after apply/ratify, tests should call audit endpoint and run a quick verification of presence/shape (signature presence is sufficient in mock mode).
* **Timeouts:** prefer explicit waits for network responses and UI events over fixed sleeps. Use `page.waitForResponse()` when possible.

---

## Artifacts & reporting

On CI failure, upload:

* Playwright trace files (`.zip`), screenshots, and video.
* `playwright-report/` generated HTML.
* Browser console logs & server logs for the session (rotate old artifacts).

In GitHub Actions, use `actions/upload-artifact@v4` for artifacts. Example snippet provided below.

---

## Example GitHub Actions job (template)

Place this in `.github/workflows/control-panel-e2e.yml`. Adjust job names, labels, and secrets.

```yaml
name: Control-Panel E2E

on:
  pull_request:
    paths:
      - 'control-panel/**'
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      NODE_ENV: test
      PLAYWRIGHT_BASE_URL: http://127.0.0.1:3000
      PLAYWRIGHT_TEST_MODE: mock
      PLAYWRIGHT_MOCK_KERNEL: 'true'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install deps
        working-directory: control-panel
        run: npm ci

      - name: Start Control-Panel (dev mode)
        working-directory: control-panel
        run: |
          npm run dev & sleep 2
        # Option: start server with env to enable test endpoints / mock hooks

      - name: Run Playwright tests
        working-directory: control-panel
        run: npx playwright test --project=chromium --reporter=list
        continue-on-error: false

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: control-panel-e2e-report
          path: control-panel/playwright-report

      - name: Upload Playwright videos/screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: control-panel-e2e-artifacts
          path: |
            control-panel/tests/results/**/*
            control-panel/playwright-report/**/*
```

**Notes:**

* For staging runs, add a separate job with `PLAYWRIGHT_TEST_MODE=staging`, set secrets (OIDC creds, admin tokens) via repository secrets, and ensure staging infra is reachable only by CI runners.

---

## Flaky tests handling

* Use `retries: 1` in CI to reduce flake noise.
* On first retry, capture trace & video.
* Fail the job if test still fails after retry.
* Maintain a `flaky-tests.md` listing known flaky tests and owners; work through flakiness rather than permanently increasing retries.

---

## PR gating policy

* **Critical flows** (multisig approval/apply, emergency ratify, audit explorer) must be green in CI for PR merge to `main`.
* Non-critical tests may be optional for PRs but must be included in nightly pipeline.

---

## Debugging tips (local & CI)

* Use `npx playwright show-trace trace.zip` to inspect traces.
* Run `npx playwright test filename --debug` to step through tests.
* Capture server logs by redirecting the app logs to a known file and uploading on failure.

---

## Maintaining the tests

* Keep selectors resilient: prefer `data-testid` attributes for test hooks.
* Keep the test data creation/teardown code in `control-panel/test/helpers/` to avoid duplication.
* Keep a single place for mock server implementations (if using an in-process mock service) to speed CI and ensure parity across tests.

---

## Checklist before enabling PR gate

* [ ] Playwright tests exist for critical flows and pass locally with `PLAYWRIGHT_TEST_MODE=mock`.
* [ ] CI job template created and tested in a draft PR.
* [ ] Artifacts & trace upload implemented (HTML report, screenshots, videos).
* [ ] Secrets configured for staging runs (if staging job enabled).
* [ ] Test owners assigned and flaky tests documented.

---
