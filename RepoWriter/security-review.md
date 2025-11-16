# RepoWriter — Security Review Checklist (for Security Engineer)

**Purpose:** a single, reproducible checklist the Security Engineer (and reviewer team) will use to validate RepoWriter before sign-off. Follow each step, mark PASS/FAIL, attach evidence (logs, screenshots, command output, links to tickets), and put your name/date at the bottom.

**Scope:** RepoWriter server, signing-proxy integration, audit pipeline, repo allowlist, rollback behavior, CI acceptance, deployment runbooks.

---

## How to use
1. For each item below, perform the check, record `PASS` or `FAIL` and paste evidence path/notes.  
2. Fix `FAIL` items or acknowledge acceptable risk with an explicit mitigation plan.  
3. When all critical items are `PASS`, complete a sign-off in `RepoWriter/signoffs/security_engineer.sig` (template provided).

---

## Metadata
- Reviewer: ______________________
- Date: __________________________
- Environment inspected: (staging/prod) ______________________
- Repo commit/tag reviewed: ______________________

---

## Critical checks (must PASS)

### 1 — Signing & KMS
- [ ] `SIGNING_PROXY_URL` configured in prod and reachable. Evidence: curl output / health endpoint.
- [ ] Signing proxy returns `signature_b64` and `signer_id` per contract. Evidence: sample sign request/response.
- [ ] `REQUIRE_SIGNING_PROXY=1` enforced in production. Evidence: prod env config or startup logs showing enforcement.
- [ ] Signing-proxy audited: request logs exist with timestamps, caller identity and signer_id. Evidence: sample log.
- [ ] Key rotation: signing-proxy supports rotation and returns `signer_id`. Evidence: doc or operation runbook.
- Notes:

### 2 — No private key leakage
- [ ] RepoWriter contains **no** private keys. Search repository for `.pem`, `.key`, or private key patterns. Evidence: grep results.
- [ ] `REPOWRITER_SIGNING_SECRET` documented as dev-only and not present in production. Evidence: env store config.

### 3 — Network & transport security
- [ ] mTLS/bearer token or private network required between RepoWriter and signing-proxy. Evidence: network policy / proxy config.
- [ ] Egress rules are limited to required endpoints (signing-proxy, telemetry, OpenAI). Evidence: cloud firewall / K8s network policies.

### 4 — Authentication & RBAC
- [ ] Human access to RepoWriter admin (if exists) requires OIDC with 2FA. Evidence: control-panel config / auth docs.
- [ ] Service-to-service calls (Kernel/SentinelNet/SigningProxy) use mTLS or service tokens. Evidence: config / secrets usage.
- [ ] RepoWriter enforces allowlist for patched paths (`repowriter_allowlist.json`). Evidence: unit test or live rejection of forbidden path.

### 5 — Patch apply & rollback safety
- [ ] Dry-run mode does not modify disk. Evidence: dry-run test and repo state verification.
- [ ] Apply produces commits with `repowriter:` prefix and returns rollback metadata. Evidence: recorded commit + rollback metadata.
- [ ] Rollback fully restores repo in all tested scenarios (single file, multi-file, partial failure). Evidence: integration test logs.
- Notes:

### 6 — Audit & immutability
- [ ] All critical actions (apply/commit/push/PR/rollback/sign) emit AuditEvents with signer metadata and timestamps. Evidence: audit messages in telemetry or audit store.
- [ ] Audit events are exported to an append-only store (S3/object-lock or equivalent). Evidence: S3 bucket policy / sample archive.
- Notes:

### 7 — Secrets management
- [ ] No secrets in git (check .env, config). Evidence: grep `.env` references and repowriter_allowlist forbids `.env`.
- [ ] Production secrets injected via secret manager (Vault/secret driver) or K8s secret with proper RBAC. Evidence: deployment manifests / Vault policies.
- Notes:

### 8 — CI safety & OpenAI usage
- [ ] CI uses OpenAI mock (no real calls). Evidence: CI job config and use of `openaiMock`.
- [ ] `ensureOpenAIKey` middleware correctly blocks heavy endpoints when no key/mock available. Evidence: middleware test results and runtime behavior.
- Notes:

### 9 — Observability, logging & alerting
- [ ] Metrics emitted: signing failures, signing latency histogram, request totals/errors. Evidence: sample metrics in Prometheus.
- [ ] Alerts configured for signing failures/latency (PrometheusRule present). Evidence: `repowriter-alerts.yaml` applied and firing tests.
- [ ] Error logs do not contain secrets. Evidence: log sampling and grep.

### 10 — Runtime hardening & container security
- [ ] Container images scanned for vulnerabilities and the CVE policy is acceptable. Evidence: image scan report.
- [ ] Minimal privileges: process runs as non-root in containers or system user in systemd. Evidence: container spec or systemd unit.
- Notes:

---

## Remediation & risk acceptance
For any `FAIL` item, record the remediation plan, owner and ETA:

- Item: ____________________
- Gap: ____________________
- Remediation: ____________________
- Owner: ____________________
- ETA: ____________________

---

## Final sign-off checklist (Security Engineer)
I confirm I have reviewed the above items and the remediation plan(s) for any non-critical gaps. I understand that critical items must be resolved before production.

- Security Engineer name: _________________________
- Signature (text): ________________________________
- Date: _________________________

---

## Evidence repository links
Paste links to relevant evidence (CI runs, logs, screenshots, Vault policy docs, audit logs, PRs):

1. CI run: ______________________  
2. Signing-proxy sample request: ______________________  
3. Audit event sample: ______________________

---

End of checklist.

