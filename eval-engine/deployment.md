# Eval Engine & Resource Allocator — Deployment, Security, and Runbook

**Purpose**
Deployment & ops guidance for the Eval Engine and Resource Allocator services. Focuses on secure hosting, KMS signing, audit emission, SentinelNet integration, Finance integration, observability, SLOs, and DR. Follow this for staging and production rollouts.

---

## 0 — Summary / Intent (one-liner)

Run Eval Engine (ingestion, scoring, promotion) and Resource Allocator (reservations, settlements) as production-grade services with mTLS, KMS-backed signing for audit, SentinelNet gating, Finance integration for ledger-backed allocations, and full operational runbooks and disaster recovery.

---

## 1 — Topology (recommended)

* Two services:

  * **eval-engine** — Eval ingestion, scoring, promotions.
  * **resource-allocator** — allocation orchestration, Finance integration, settlement.
* Supporting systems:

  * Postgres (authoritative metadata), separate DB per service (PITR + WAL).
  * Kafka/Redpanda (optional) for audit/event bus.
  * S3 / MinIO for artifact/snapshot export.
  * KMS / Signing Proxy (for audit signing).
  * SentinelNet (policy engine).
  * Finance (ledger) service.
  * Redis (optional) for short-term locks/queues.
  * Prometheus + Grafana for metrics and alerting.
  * OTEL collector for traces.

Diagram (logical):

```
Clients (Agent / CI / Kernel) -> Kernel (mTLS) -> Eval Engine -> Resource Allocator
                 |                                  |
             SentinelNet (policy)                 Finance (ledger)
                 |                                  |
                 --> Kernel audit bus (Kafka) --> Audit indexer/S3
```

---

## 2 — Required cloud components & names (exact)

* **Postgres** (>=14) with PITR and WAL archiving

  * env var: `EVAL_DATABASE_URL`, `ALLOC_DATABASE_URL`
* **Audit stream** (Kafka/Redpanda)

  * topic: `audit-events`
* **S3** for artifact & snapshot export

  * env vars: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET`
* **KMS/HSM** (preferred) or signing-proxy

  * env vars: `AUDIT_SIGNING_KMS_KEY_ID`, `AUDIT_SIGNER_KID`, `SIGNING_PROXY_URL`
* **Secrets manager** (Vault / Secret Manager)

  * use for DB creds, KMS creds, token rotation

---

## 3 — Environment variables (minimum)

Example runtime minimum for Eval Engine:

```
NODE_ENV=production
PORT=8050
EVAL_DATABASE_URL=postgresql://user:pass@host:5432/eval_engine
ALLOC_DATABASE_URL=postgresql://user:pass@host:5432/allocator
KERNEL_API_URL=https://kernel.illuvrse.internal
REQUIRE_MTLS=true
REQUIRE_KMS=true
AUDIT_SIGNING_KMS_KEY_ID=arn:aws:kms:...
AUDIT_SIGNER_KID=eval-audit-signer-v1
SIGNING_PROXY_URL=https://signer.internal
SENTRY_DSN=...
OTEL_COLLECTOR_URL=https://otel.internal:4317
S3_ENDPOINT=https://s3.internal
S3_REGION=us-east-1
S3_ACCESS_KEY=...
S3_SECRET=...
SENTINELNET_URL=https://sentinelnet.internal
FINANCE_API_URL=https://finance.internal
PROM_ENDPOINT=https://prom.internal
```

**Dev overrides**

```
DEV_SKIP_MTLS=true
DEV_ALLOW_EPHEMERAL=true   # only for local testing, not allowed in production
```

`NODE_ENV=production` + `DEV_SKIP_MTLS=true` MUST cause startup failure.

---

## 4 — KMS / Signing & Audit semantics

* **Production signing must use KMS/HSM**. No private keys in repo or images.
* **Signing semantics**:

  * Compute canonical payload per Kernel rules.
  * `hash = sha256(canonical(payload) || prevHash)` (Kernel canonicalization). Sign `hash`.
  * Signatures must be base64; signers identified by `signer_kid`.
* **Env & behavior**:

  * `REQUIRE_KMS=true` ensures service refuses to start if no signer configured.
  * Use `AUDIT_SIGNING_KMS_KEY_ID` or `SIGNING_PROXY_URL`.
  * Audit emission must be atomic with state mutation; implement transactional patterns.

**IAM**

* Minimal IAM policy restricted to `kms:Sign`, `kms:Verify`, `kms:GetPublicKey` for audit signer.

---

## 5 — Network security & authentication

* **mTLS** between Kernel ↔ Eval Engine ↔ Resource Allocator ↔ SentinelNet ↔ Finance.

  * `REQUIRE_MTLS=true` in production.
  * Use Vault PKI or internal CA; short-lived certs via automation.
* **Human auth**: OIDC/SSO for dashboards/operator endpoints.
* **RBAC**:

  * Roles: `superadmin`, `eval-admin`, `operator`, `auditor`.
  * Kernel mediates certain high-risk flows; kernel approves promotions to production.
* **Admin endpoints** secured with additional checks (multisig for destructive ops).

---

## 6 — Deployment artifacts (example)

* **Kubernetes** (Helm chart recommended)

  * `values-prod.yaml` includes secret references (Vault CSI), replicas=3, HPA, PodDisruptionBudget.
  * Liveness/readiness probes: `/health` and `/ready` (DB + Kernel + Signer checks).
* Example snippet:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: eval-engine
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: eval-engine
          image: illuvrse/eval-engine:prod
          envFrom:
            - secretRef: { name: eval-engine-secrets }
          ports: [{ containerPort: 8050 }]
          readinessProbe:
            httpGet: { path: /ready, port: 8050 }
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /health, port: 8050 }
            initialDelaySeconds: 30
            periodSeconds: 30
      restartPolicy: Always
```

---

## 7 — Observability, metrics & SLOs

**Metrics (required)**:

* `eval_engine.eval_submissions_total`
* `eval_engine.eval_submission_latency_seconds` (histogram)
* `eval_engine.promotions_total` (labels: status, policy)
* `allocator.allocations_total`
* `allocator.settlement_failures_total`
* `allocator.allocation_latency_seconds`
* `eval_engine.policy_denials_total`

**SLOs (example)**:

* Eval submission p95 < 200ms (dev) / prod p95 < 100ms
* Promotion request p95 < 500ms (unless synchronous SentinelNet compute required)
* Allocation request p95 < 1s for initial reservation; settlement is dependent on Finance

**Alerts**

* KMS/signing failures (high)
* SentinelNet policy failures spike
* Finance settlement failures > threshold
* DB replication lag > threshold

**Tracing**

* Instrument promotion flows across Kernel → Eval → SentinalNet → Allocator → Finance.

---

## 8 — CI / Guardrails & tests

* **Protect branches**: CI job must assert `REQUIRE_KMS=true` for protected branches that may be promoted.
* **Contract tests**: Implement OpenAPI contract tests against a local mock or staging stack. Use `eval-engine/test/contract.test.js` or similar.
* **Integration tests**:

  * `eval->promote->reasoning-graph` flow (mock Kernel to mediate).
  * `alloc->finance->settle` acceptance; mock Finance to return signed ledger proof.
  * SentinelNet gating scenarios (allow/deny/multisig).
* **Security tests**:

  * Secrets scanning
  * SAST (static analysis)
  * CI script `./scripts/ci/check-no-private-keys.sh` executed on PR

**Example CI jobs**

* `eval-engine-ci.yml`:

  * lint, unit tests, contract tests, KMS guard, integration acceptance.

---

## 9 — Backup, DR & replay

* **Postgres**: PITR + daily full snapshots. Monthly restore drills.
* **Audit replay**:

  * Export audit events (S3) and provide tools to replay into a test DB to validate chain (use Kernel audit-verify tooling).
* **DR drill**:

  1. Restore Postgres snapshot in test cluster.
  2. Run `scripts/rebuild_from_audit.sh` to replay audit events to restore derived state.
  3. Run parity tests and reconcile allocations and promotions.

---

## 10 — Finance & settlement integration

* **Reservation workflow**:

  * Resource Allocator creates reservation → calls Finance to create an invoice/ledger reservation → Finance returns reservation id and ledger lines.
  * If Finance returns failure, roll back or keep allocation pending and emit AuditEvent.
* **Settlement**:

  * `alloc/settle` validates ledger proof signature and balanced entries before marking allocation settled.
  * Use `finance/tools/generate_ledger_proof.sh` in staging to produce proofs for testing.
* **Acceptance**:

  * E2E: allocate → simulate payment capture → Finance ledger proof → call `alloc/settle` → assert `status: settled`.

---

## 11 — Runbooks (must exist)

Provide easily accessible runbooks:

* `eval-engine/runbooks/incidents.md` — handle KMS/signing failures, SentinelNet outage, Finance unavailability.
* `eval-engine/runbooks/key_rotation.md` — rotate audit signer and update `AUDIT_SIGNER_KID`.
* `eval-engine/runbooks/drill.md` — DR drill steps: restore DB, replay audit, validate parity.
* `eval-engine/runbooks/reconcile.md` — how to run manual reconciliation between allocations and finance.

**Examples (short)**:

* **KMS down**:

  1. Mark service read-only (reject writes).
  2. Notify Security/SRE on-call.
  3. Use emergency signer only if authorized and recorded; mark events as `provider: emergency` in audit.
* **Finance unreachable**:

  1. Keep allocations in `pending_finance`.
  2. Retry with exponential backoff and DLQ.
  3. On prolonged outage, alert Finance/SRE; run reconciliation when restored.

---

## 12 — Health checks & diagnostics

**Endpoints**

* `GET /health` — overall health
* `GET /ready` — readiness: DB ping, Kernel probe, Signer/KMS probe, SentinelNet reachability
* `GET /metrics` — Prometheus format
* `GET /debug/state` — (restricted) show current pending allocations/promotions (admin only)

**Minimal readiness logic**

* DB reachable
* Kernel reachable (for kernel-authenticated actions)
* Signer reachable or DEV_ALLOW_EPHEMERAL allowed
* SentinelNet reachable (or operate in degraded mode with an alert)

---

## 13 — Acceptance criteria (deployment)

Before production promotion, each of the following must be present and passing:

* `eval-engine/acceptance-criteria.md` and `eval-engine/api.md` present and validated. 
* `REQUIRE_MTLS=true` enforced in production and `DEV_SKIP_MTLS` disabled.
* KMS integration validated in staging (`AUDIT_SIGNING_KMS_KEY_ID` tested).
* Contract tests and integration acceptance tests pass in CI.
* Audit emission and chain verification (kernel/tools/audit-verify.js) verify sample events including eval-engine events.
* SLO dashboards and Prometheus alerts configured.
* Runbooks created and tabletop run performed.
* Security signoff: `eval-engine/signoffs/security_engineer.sig`.
* Final signoff: `eval-engine/signoffs/ryan.sig`.

---

## 14 — Minimal reviewer commands

```bash
# From repo root
# Install deps (node/go etc)
npm ci --prefix eval-engine
npm run test --prefix eval-engine

# Run contract tests locally against a mock Kernel
npm run eval:contract --prefix eval-engine

# Run integration e2e (eval->promote->alloc) in local staging
./eval-engine/scripts/run-e2e-local.sh

# KMS smoke
node eval-engine/scripts/verify_audit_signer.js

# Run final audit verification
scripts/run_final_audit.sh
```

---

## 15 — Notes & references

* Use Kernel canonicalization / parity helpers for hashing.
* All audit events must be consumable by Kernel audit-verify tool.
* See `eval-engine/acceptance-criteria.md` (and `eval-engine/api.md`) for the tests that must pass before sign-off. 

---

End of `eval-engine/deployment.md`.

---
