# Control-Panel — Acceptance Criteria

**Purpose:** testable, automatable acceptance gates proving the Operator UI (Control-Panel) is correct, secure, auditable, and production-ready. This file defines the exact checks a reviewer must run or verify in CI/staging before signing off.

---

## Quick notes / where this lives

Path: `control-panel/acceptance-criteria.md`
Final approver: **Ryan (SuperAdmin)**. Required reviewer: **Security Engineer**. Security & SentinelNet must sign off on policy/ratification flows.

Reference implementation and run hints: `control-panel/README.md`. 

---

## 1) Purpose & goal summary

* Provide operator workflows to manage Kernel upgrades, SentinelNet verdicts, Reasoning Graph trace review, and audit exploration.
* All operator actions that modify system state must be proxied through Kernel (signed, auditable).
* The UI must enforce RBAC/SSO, protect secrets server-side, and provide deterministic e2e test coverage (Playwright) for the critical flows.

---

## 2) Files that must exist (exact paths)

Ensure the following files exist in the repo and are kept in sync with implementation:

* `control-panel/acceptance-criteria.md` *(this file)*
* `control-panel/README.md` *(exists; used for quickstart and env refs)*. 
* `control-panel/src/lib/kernelClient.ts` — Kernel client wrapper (server-proxied endpoints)
* `control-panel/src/lib/signingProxy.ts` — signing proxy client/adapter
* `control-panel/src/app/upgrades/*` — UI pages/components for upgrades dashboard and detail (approvals/apply/emergency)
* `control-panel/src/app/audit/*` — audit explorer UI
* `control-panel/src/api/kernel/*` or `control-panel/src/pages/api/kernel/*` — server-side API routes that proxy to Kernel (so secrets remain server-side)
* `control-panel/.env.example` — example env showing `KERNEL_API_URL`, `KERNEL_CONTROL_PANEL_TOKEN`, `SIGNING_PROXY_URL`, `CONTROL_PANEL_SESSION_SECRET` etc. 
* `control-panel/playwright.config.ts` and `control-panel/e2e/*` — Playwright tests for critical flows (approval, apply, emergency ratification, audit trace review)
* `control-panel/deployment.md` — deployment topology / mTLS and secrets guidance (see section 7)
* `control-panel/runbooks.md` — operator runbooks (emergency ratification, rollback, on-call actions)
* `.github/workflows/control-panel-e2e.yml` — CI job to run Playwright e2e against a staging stack or mocked Kernel/SentinelNet/ReasoningGraph.

If any of these are missing the PR is incomplete.

---

## 3) Local quickstart & smoke checks

From repo root, in `control-panel/`:

```bash
# install deps
cd control-panel
npm ci

# start in dev (server-side env required)
cp .env.example .env.local
# set minimal env for demo mode if you don't have Kernel:
# KERNEL_API_URL omitted -> app runs in demo mode
npm run dev
```

Smoke checks:

```bash
# health / demo mode
curl http://localhost:3000/health
# auth page
curl -fsS http://localhost:3000/login
# upgrades page (stubbed in demo mode)
curl -fsS http://localhost:3000/upgrades
```

Expected: endpoints return `200` and demo flows operate when `KERNEL_API_URL` omitted. If real Kernel is configured, UI returns data from Kernel endpoints.

---

## 4) Acceptance tests — manual & automated (critical flows)

### A. Authentication & RBAC (blocking)

**What to test**

* OIDC id_token flow: server-side `/api/session` accepts a valid OIDC `id_token` and maps roles (`kernel-admin`, `kernel-approver`, `operator`) correctly.
* Admin password fallback should be permitted only for local/dev and disabled in production.
* Server must store session in HTTP-only cookie signed with `CONTROL_PANEL_SESSION_SECRET`.

**How to verify**

* Unit tests for `src/lib/session` middleware.
* Manual test: issue a valid id_token (or `DEMO_OIDC_TOKEN`) and assert UI shows appropriate controls for each role.
* Production guard: start server with `NODE_ENV=production` and verify `ADMIN_PASSWORD` fallback is rejected.

### B. Kernel client / operator action proxying (blocking)

**What to test**

* All operator actions that mutate state (approve, apply, emergency apply, submit ratification) must be proxied server-side through `/api/kernel/*` endpoints and then sent to `KERNEL_API_URL` with server-side token `KERNEL_CONTROL_PANEL_TOKEN`.
* Client MUST NOT call Kernel directly from the browser with secret tokens.

**How to verify**

* Inspect `control-panel/src/pages/api/kernel/*` handlers and unit tests asserting they forward requests and inject server-side token.
* Start a staging Kernel mock and exercise the UI action; confirm Kernel receives the proxied request and Control-Panel emits an AuditEvent id in response.
* Automated test: integration test that stubs Kernel and asserts `headers.authorization` present and not exposed to the client.

### C. Upgrades workflow (approvals / multisig / apply / emergency) (blocking)

**What to test**

* Dashboard shows upgrade list; detail page shows approvals and SentinelNet verdicts.
* Approval flow captures ratification notes, records the operator identity, and proxies approval through Kernel.
* Multisig gating: for high-risk upgrades, the UI must block "apply" until required approvals are present; emergency apply requires ratification capture and emits a signed audit event.

**How to verify**

* Playwright test: simulate 5 operators, submit 3-of-5 approvals, confirm `apply` becomes available and that audit events recorded contain operator IDs and rationale.
* Manual: create a draft upgrade, collect approvals, call apply via UI, and inspect Kernel logs for multisig apply request.

### D. SentinelNet & Reasoning Graph integrations (blocking)

**What to test**

* Detail view surfaces SentinelNet verdicts (allow/deny/quarantine) and explanation rationale.
* Reasoning Graph trace review: UI fetches traces and presents ordered causal paths and annotations.
* Emergency flows must show SentinelNet blocking status and require ratified override (if policy allows).

**How to verify**

* Integration test with Kernel mock returning SentinelNet verdicts and Reasoning Graph traces; UI displays the rationale and allows annotation; annotations are sent to Reasoning Graph via Kernel (or Kernel-authenticated endpoint).
* Manual: annotate a node and verify annotation persists in Reasoning Graph.

### E. Audit explorer & trace review (blocking)

**What to test**

* Audit explorer should allow searching by `actor_id`, `event_type`, `time-range` and present canonical payload + signature metadata.
* Clicking an audit row shows linked Reasoning Graph nodes (if any) and the canonicalization/verification status.

**How to verify**

* Unit test for `audit` API routes; Playwright test to exercise search and inspect modal details; verify `X-Request-Id` and `request_id` are included and traceable.

### F. Emergency ratification / rollback (blocking)

**What to test**

* Emergency apply requires ratification capture; rollback flow must show prior state and allow rollback with multisig constraints.
* No rollout action should proceed without Kernel approval/signature.

**How to verify**

* Playwright test: perform emergency apply, capture ratification, then perform rollback, validate audit events and Kernel multisig flow.

---

## 5) Security & signing (blocking)

* Production requirements:

  * All server-to-server calls MUST use mTLS or server-side bearer tokens. `KERNEL_API_URL` access must be secured by `KERNEL_CONTROL_PANEL_TOKEN` or mTLS. 
  * Signing proxy support: `signingProxy.ts` must support `SIGNING_PROXY_URL`. In demo mode a deterministic dev signature is acceptable but must be clearly labeled in the UI. 
  * No client-side secret leakage: UI must never return `KERNEL_CONTROL_PANEL_TOKEN` or other secrets to the browser.
* KMS enforcement in CI for protected branches: CI should reject PRs that attempt to configure production without a KMS/signing-proxy configuration.

**How to verify**

* Security unit tests that fail when server code attempts to expose tokens in the response body.
* Brownbox test: grep build artifacts for secret patterns (private key PEM) in CI.
* CI job: `./scripts/ci/check-no-private-keys.sh` (or comparable) run as part of `control-panel` workflow.

---

## 6) Observability & metrics (P1)

**What to expose**

* `control_panel.requests_total` (counter), `control_panel.request_latency_seconds` (histogram), `control_panel.operator_actions_total` (counter by action), `control_panel.sentinel_verdict_latency_seconds` (histogram).

**How to verify**

* `/metrics` endpoint present and includes the above metrics.
* Prometheus alert rules (in `control-panel/deployment.md`) for high error rates and unusual approval patterns.

---

## 7) Runbooks & deployment (blocking)

Provide the following docs (see Required files list). Each must be present and actionable:

* `control-panel/deployment.md` — include:

  * topology diagram (browser -> CDN -> Next.js server -> Kernel proxy -> Kernel), secrets management (Vault or secret manager), mTLS requirements, and SSO config.
  * instructions for `KERNEL_CONTROL_PANEL_TOKEN` rotation and how to configure `SIGNING_PROXY_URL`.
  * production guardrails (deny local fallback in `NODE_ENV=production`).

* `control-panel/runbooks.md` — include:

  * Emergency ratification runbook (step-by-step to ratify emergency apply and how to record ratification in audit).
  * Rollback procedures and how to execute an emergency rollback via UI and Kernel API.
  * On-call checklist (SRE responsibilities, logs to check, how to take UI offline safely).

**How to verify**

* Reviewer should perform a tabletop runbook drill: simulate SentinelNet auto-deny, perform emergency ratification per runbook, then execute rollback.

---

## 8) CI / e2e (blocking)

* Provide `playwright` tests under `control-panel/e2e/` covering:

  * Authentication/role mapping
  * Approvals → apply (multisig)
  * Emergency apply & rollback
  * Audit explorer trace review and annotation
* Add `.github/workflows/control-panel-e2e.yml` that:

  * Boots a small staging stack or Kernel/SentinelNet/Reasoning Graph mocks.
  * Runs Playwright tests headlessly and uploads artifacts on failure.

**How to verify**

* Merge candidate: CI job must pass on PR and produce Playwright reports; if CI cannot run full stack, it must run against well-documented mocks.

---

## 9) Final acceptance checklist (copy into PR body)

Mark each item **PASS** only when tests pass and docs exist.

* [ ] `control-panel/README.md` updated with exact env + demo/run instructions. 
* [ ] `control-panel/acceptance-criteria.md` present (this file).
* [ ] `control-panel/deployment.md` present and reviewed by Security.
* [ ] `control-panel/runbooks.md` present and exercised in a tabletop drill.
* [ ] Playwright e2e tests exist and pass in CI (`control-panel/e2e/*`).
* [ ] Kernel proxy routes exist and have unit tests ensuring server-side token usage.
* [ ] SentinelNet/ReasoningGraph integration tests (or mocked equivalents) exist and pass; UI displays verdicts and traces.
* [ ] Emergency ratification & rollback flows covered by e2e/automation.
* [ ] Metrics exposed and Prometheus rules documented.
* [ ] No secrets or private keys committed to the repo (CI check passes).
* [ ] Security Engineer reviewed & approved signing/KMS details and ratification runbooks.
* [ ] Final sign-off: **Ryan (SuperAdmin)**.

---

## Minimal reviewer commands (copy/paste)

```bash
# From control-panel dir
npm ci
# unit tests
npm test

# start a dev instance (use real Kernel endpoints or demo)
cp .env.example .env.local
# if you have Kernel + Signing Proxy in env, set them; otherwise use demo mode
npm run dev

# run Playwright tests (local)
npx playwright test --project=chromium

# Quick check: ensure server-side proxy routes don't leak tokens
# run integration harness that hits /api/kernel/* handlers and assert no token in responses
```

---

## Sign-off note

Once the above files, tests, runbooks and CI jobs are present and green, add a short `control-panel/signoffs/security_engineer.sig` and `control-panel/signoffs/ryan.sig` per the repo signoff pattern to complete the gate.

---
