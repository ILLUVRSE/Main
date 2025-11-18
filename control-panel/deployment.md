# Control-Panel — Deployment, Security & Runbook

## Purpose

Control-Panel is the operator-facing UI and server proxy that performs multisig approvals, supervises upgrades, exposes an audit explorer and trace viewer, and allows operators to perform high-privilege actions safely. This document defines the required production configuration, security constraints, observability, and acceptance checks.

---

## 0 — One-line intent

Run Control-Panel as a hardened, server-proxied operator UI that never exposes secrets to the browser, proxies state-changing Kernel calls server-side, enforces multisig for high-risk actions and emits audit events for all operator actions.

---

## 1 — Topology & components

* **Control-Panel frontend** — React/Next or similar UI served via CDN or behind LB; no secrets in the browser.
* **Control-Panel server** — server-side proxy and orchestration service that:

  * validates operator auth (OIDC),
  * performs Kernel mTLS calls on behalf of users,
  * coordinates multisig flows, upgrades, and audit replay commands,
  * stores minimal operational caches and read-only indices,
  * emits AuditEvents for operator actions.
* **Kernel** — authoritative control plane; Control-Panel proxies state changes to Kernel via mTLS and Kernel verifies multisig constraints.
* **Audit indexer/Search** — Postgres/Elastic index of audit events and S3 archive for raw events.
* **Signing/KMS** — used by Kernel and Control-Panel only as required for operator signing flows (Control-Panel must **not** hold private keys).
* **Playwright CI** — E2E tests that run in CI (headless or headed) validating flows: multisig, upgrade apply, audit exploration.

---

## 2 — Required cloud components & env vars

* Kubernetes (EKS/GKE/AKS) or managed app platform for server.
* **Secrets manager** (Vault / Secret Manager) for mTLS certs, OIDC client secret.
* **KMS** / signing proxy (if Control-Panel needs to generate signed pointers — documented usage below).
* **Kernel API URL & client certs**:

  * `KERNEL_API_URL`
  * `KERNEL_CLIENT_CERT_PATH` / `KERNEL_CLIENT_KEY_PATH` or mounted mTLS secret
* **OIDC config**:

  * `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
* **Prometheus / OTEL / Sentry**:

  * `PROM_ENDPOINT`, `OTEL_COLLECTOR_URL`, `SENTRY_DSN`
* **Audit index**:

  * `AUDIT_INDEX_URL` or Postgres connection for fast search
* **Playwright**:

  * CI runner must have access to ephemeral test service accounts and be able to seed Kernel mocks.

---

## 3 — Security & auth model (MUST)

* **Human auth**: OIDC/SSO for operators. Map OIDC claims to roles: `SuperAdmin`, `DivisionLead`, `Operator`, `Auditor`.
* **Server-side proxy only**: All state-changing operations (kernel.applyUpgrade, kernel.signUpgrade, kernel.applyMultisig, manifest apply operations) must be executed server-side by Control-Panel using mTLS to Kernel. The browser must never directly call Kernel or hold private keys.
* **mTLS**: Control-Panel → Kernel communication uses mTLS. Control-Panel presents a short-lived client cert provisioned from Vault PKI or an internal CA.
* **Least privilege**: Control-Panel must restrict which roles can start multisig approval flows vs. emergency approvals. Emergency actions require post-hoc ratification.
* **Multisig enforcement**: Control-Panel MUST support:

  * Creating an upgrade manifest draft that includes `preconditions` and `test results` links.
  * Collecting approvals (via UI action that triggers an audit-signed approval or KMS sign request).
  * Submitting approval records to Kernel (Kernel enforces 3-of-5 quorum).
  * Displaying approval status and audit trail.
* **No secrets in browser**: Do not embed API keys, certificates, or private keys in frontend bundles or environment. The server supplies only ephemeral presentation data.

---

## 4 — Multisig upgrade UI & actions (MUST)

* **Prepare upgrade**: UI allows an operator to upload manifest + rationale + tests + impact. The server writes a draft upgrade event to Kernel (or draft in local DB).
* **Review & Approve**:

  * Approver identity is derived from OIDC subject.
  * Approval action MUST generate an audit event and either:

    * Call KMS-signing flow (if approver uses KMS-backed signing), or
    * Provide a signed Approval Record created by Kernel's signer endpoint.
  * Prevent self-approval for the same user (approver must be distinct).
* **Apply**:

  * After quorum, Control-Panel invokes Kernel's apply endpoint over mTLS and records audit events pre/post apply.
  * Post-apply: server runs canary automation or calls CI to run smoke tests and records results.
* **Emergency**:

  * Support an Emergency Apply flow with explicit reasons and set `emergency=true` in manifest. Emergency apply must be subject to retroactive ratification within configured window.
* **UI Evidence**:

  * Show diffs, test results, signer ids, and a link to the kernel audit chain for each upgrade.

---

## 5 — Audit explorer & trace viewer (MUST)

* Provide an operator UI to:

  * Search audit events (by actor, eventType, time range).
  * Display audit event details (payload, prevHash, hash, signature, signerId).
  * Link audit events to Reasoning Graph traces and artifacts (click-through).
  * Show policy decisions and multisig approval artifacts.
* **Security**:

  * Only `Auditor` and above can view PII. Non-privileged roles see redacted fields per PII policy.
* **Performance**:

  * Provide paginated search and filter; use Postgres/Elastic index for fast queries; raw event payloads read from S3 on demand.

---

## 6 — Playwright E2E & CI (MUST)

* **Tests**:

  * Full Playwright tests exercising:

    * Login (OIDC mock), list upgrades, create upgrade draft, review, approve, apply flows.
    * Emergency apply and retroactive ratification flow.
    * Audit explorer search and trace linking.
    * Control-Panel role-based access tests for operator vs. auditor.
  * Use stable test accounts and a Kernel mock or staging Kernel.
* **CI job**:

  * `control-panel-e2e.yml` runs Playwright tests in CI (headless). It must:

    * Deploy a test stack (Kernel mock + Control-Panel) or reuse a staging environment.
    * Ensure `REQUIRE_MTLS` and `REQUIRE_KMS` guard behaviors are respected / simulated.
    * Report artifacts: Playwright traces, video, and logs in `progress/` or CI artifacts.
* **Acceptance**:

  * Playwright E2E must pass in CI for sign-off. Control-Panel acceptance criteria require Playwright coverage.

---

## 7 — Deployment patterns & infra

* **Kubernetes** recommended:

  * Deploy server as Deployment (replicas ≥ 2), HPA, PodDisruptionBudget, network policy to allow only Kernel and SRE subnets.
  * Frontend served via CDN or ingress with Web Application Firewall (WAF).
* **Readiness & liveness**:

  * `/health` and `/ready` must check:

    * DB connectivity
    * Kernel connectivity (mTLS handshake)
    * Audit indexer reachable
    * Signer availability (if server relies on signer)
  * Startup fails if `NODE_ENV=production` and `DEV_SKIP_MTLS=true`, or `REQUIRE_KMS=true` and no signer configured.
* **Secrets**:

  * Use Vault/secret manager and avoid environment injection of private keys. Use CSI driver or K8s Secrets with strict RBAC.
* **CI/CD**:

  * PR gates: lint, unit tests, contract checks, Playwright smoke (optional), security scans.

---

## 8 — Runbooks (MUST)

Provide these runbooks inside `control-panel/runbooks/`:

* `multisig.md` — how to investigate multisig failures, re-send approval requests, and manual approval reconciliation.
* `emergency-apply.md` — steps to perform emergency apply and post-hoc ratification.
* `audit-explorer.md` — how to investigate an audit event, verify chain, and export an audit bundle to S3.
* `drill.md` — tabletop on upgrading and rollback drills including canary simulations.

**Examples (short)**

* **If Kernel unreachable**:

  1. Set instance to read-only (UI shows degraded state).
  2. Notify Kernel on-call, retry mTLS cert checks.
  3. Keep audit logs locally and flush once connectivity restored.
* **If approvals are not being recorded**:

  1. Check Control-Panel server logs for sign/submit errors.
  2. Verify Kernel API reachability and signer registry.
  3. If approvals exist locally, re-submit Approval Records to Kernel with retry/backoff.

---

## 9 — Observability & SLOs

**Metrics**

* `control_panel.ui.page_load_seconds`
* `control_panel.upgrade_create_latency_seconds`
* `control_panel.approval_submit_latency_seconds`
* `control_panel.apply_upgrade_latency_seconds`
* `control_panel.audit_search_latency_seconds`

**SLO examples**

* UI page load p95 < 1s (internal network)
* Approval submit p95 < 300ms
* Apply upgrade latency p95 < 5s (plus canary run time)

**Tracing**

* Trace end-to-end action: operator login → draft creation → approval submission → Kernel apply.

---

## 10 — Acceptance & checks (MUST)

Before final sign-off:

* Playwright E2E coverage exists and passes in CI for critical flows.
* Control-Panel server proxies all state-changing Kernel calls (verify no direct browser-to-Kernel calls).
* Multisig upgrade flows demonstrated end-to-end with Kernel (including emergency apply and retroactive ratification).
* Audit explorer can search `policy.decision`, `upgrade.applied`, and show trace links to Reasoning Graph snapshots.
* PII redaction enforced: non-auditor roles cannot see PII in audit explorer.
* `control-panel/signoffs/security_engineer.sig` and `control-panel/signoffs/ryan.sig` present.

---

## 11 — Reviewer quick commands

```bash
# local dev
npm ci --prefix control-panel
npm start --prefix control-panel           # run server (dev)
# run Playwright locally
npx playwright test --config=control-panel/playwright.config.ts

# run server tests
npm test --prefix control-panel

# check proxy behaviour (example)
curl -X POST https://control-panel.local/api/upgrade -H "Authorization: Bearer <token>" -d @manifest.json
```

---

## 12 — Signoffs

* Security Engineer: `control-panel/signoffs/security_engineer.sig`
* Final Approver: `control-panel/signoffs/ryan.sig`

---

End of `control-panel/deployment.md`.

---
