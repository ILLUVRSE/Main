# Eval Engine & Resource Allocator — Acceptance Criteria

Purpose: concise, testable checks proving the Eval Engine and Resource Allocator are correct, secure, auditable, and production-ready. Each criterion is actionable and verifiable.

---

## # 1) API & contract
- **Endpoints implemented:** `/eval/submit`, `/eval/agent/{id}/score`, `/eval/scoreboard`, `/eval/promote`, `/eval/retrain`, `/alloc/request`, `/alloc/{id}`, `/alloc/approve`, `/alloc/reject`, `/alloc/pools`, `/alloc/preempt`.
- **Auth & RBAC:** Kernel-authenticated (mTLS) calls succeed; unauthenticated or insufficient-role calls are rejected (`401`/`403`).

**How to verify:** Run contract tests and role-based access tests against each endpoint.

---

## # 2) Eval ingestion & persistence
- **Eval accepted:** `POST /eval/submit` accepts valid EvalReports and persists them.
- **Idempotency:** Duplicate submissions with same idempotency key do not create duplicates.
- **Backpressure behavior:** If ingestion backlog grows, API returns accepted/queued and metrics reflect queue depth.

**How to verify:** Submit sample EvalReports; check persistence and idempotency; simulate backlog and observe behavior.

---

## # 3) Scoring correctness & explainability
- **Score computation:** Scores computed per configured windows (e.g., 1h/24h/7d) and normalization rules.
- **Component breakdown:** Every score exposes a breakdown of component contributions and confidence.
- **Deterministic output:** Given synthetic inputs, scores and breakdowns match expected values.

**How to verify:** Run unit tests with synthetic datasets and confirm score outputs and breakdowns.

---

## # 4) Promotion & recommendation flow
- **Promotion events:** Eval emits PromotionEvents when thresholds/conditions are met (with rationale & confidence).
- **Hysteresis:** Promotions require sustained condition over configured windows to prevent thrashing.
- **Reasoning recorded:** Promotion recommendations are recorded to the Reasoning Graph and linked with AuditEvents.

**How to verify:** Produce sustained synthetic metrics triggering promotion; verify PromotionEvent, Reasoning Graph node, and audit record.

---

## # 5) Resource allocation lifecycle
- **Request → approval → apply:** Allocations follow `requested → pending → approved/applied` lifecycle.
- **Transactional apply:** Allocation apply is transactional: reservation → infra request → confirm → audit. Rollbacks restore accounting on failure.
- **Status reporting:** `GET /alloc/{id}` returns accurate status and timestamps.

**How to verify:** Simulate end-to-end allocation request, approve it, and confirm resources are reserved/applied with audit event. Force a failure during apply and confirm rollback of reservation.

---

## # 6) SentinelNet policy enforcement
- **Policy checks required:** All allocation applies and critical promotions run SentinelNet checks.
- **Policy outcomes audited:** SentinelNet decisions (allow/deny/quarantine) are logged as AuditEvents with `policyId` and rationale.

**How to verify:** Deploy a test policy blocking an allocation; attempt allocation and confirm `403`/rejection and an audit event with policy details.

---

## # 7) Finance & budget integration
- **Budget gating:** Capital allocations consult Finance; allocations that exceed budget are rejected or sent for escalation.
- **Ledger reconciliation:** Allocation `applied` states produce ledger entries (or mock confirmations) before finalization for capital flows.

**How to verify:** Request a capital allocation; simulate Finance approval/rejection and confirm behavior and audit logs. For large amounts, confirm multi-sig requirement enforced.

---

## # 8) Retrain orchestration
- **Retrain job lifecycle:** `POST /eval/retrain` creates retrain jobs with proper queueing and status transitions.
- **Resource booking:** Retrain jobs request GPU hours from Resource Allocator and respect quotas/budget.
- **Result ingestion:** Retrain results (metrics) are captured and used by Eval to propose model promotions.

**How to verify:** Create a mock retrain job, allocate resources, run a simulated training, post results, and verify downstream model promotion flow.

---

## # 9) Canary & rollback behavior
- **Canary promotion:** Promotions can be applied in canary mode (limited allocation) and monitored before full apply.
- **Auto-rollback:** If post-apply metrics or canary checks fail, Eval triggers demotion/preemption and Resource Allocator reclaims resources.

**How to verify:** Run a canary promotion, simulate canary failure, and confirm automatic demotion and resource reclamation with audit events.

---

## # 10) Auditability & signatures
- **Audit events emitted:** PromotionEvents, AllocationRecords, RetrainJobs, and key decisions produce AuditEvents with `hash`, `prevHash`, and `signature`.
- **Verifiable chain:** Audit chain verification succeeds on emitted events.
- **Manifest linkage:** Promotion/allocation actions reference ManifestSignature or Upgrade artifacts when applicable.

**How to verify:** Generate a sequence of Promotion → Allocation events and run chain verification on the audit sink.

---

## # 11) Observability, metrics & alerts
- **Metrics present:** eval ingestion rate, scoring latency, promotion rate, allocation request latency, allocation success rate, retrain queue length, preemption events.
- **Tracing:** End-to-end tracing from eval submit to allocation apply with trace IDs.
- **Alerts:** Alert on excessive promotion rates, allocation failures, retrain queue growth, and scoring pipeline backfill needs.

**How to verify:** Check Prometheus/Grafana dashboards and trigger alert conditions in staging.

---

## # 12) Resilience, scaling & replay
- **Scaling:** Workers autoscale based on queue depth and throughput; leader election prevents race conditions.
- **Replay:** Ability to replay EvalReports from Kafka/archive and recompute scores idempotently.
- **Backfills:** Support deterministic backfill of scores from archived telemetry.

**How to verify:** Run replay/backfill tests and ensure computed scores match original run; run scale tests to target throughput.

---

## # 13) Security & secrets
- **mTLS & RBAC:** Kernel-only mTLS for orchestrated calls; RBAC enforced for sensitive actions.
- **Secrets:** Secrets stored in Vault; no secrets in repo or logs.
- **Key management:** Allocation and promotion signatures use KMS/HSM where required.

**How to verify:** Test mTLS enforcement and confirm secrets are not persisted in logs/DB.

---

## # 14) Tests & automation
- **Unit tests:** Coverage for scoring logic, hysteresis, normalization, and allocation reconciliation.
- **Integration tests:** End-to-end tests for Eval submit → score → promotion → allocation → apply → audit.
- **Chaos tests:** Simulate Kafka lag, Postgres failover, and worker crashes; confirm safe behavior and audit integrity.

**How to verify:** Run CI test suite and chaos scenarios in staging.

---

## # 15) Documentation & sign-off
- **Docs present:** `eval-engine-spec.md`, `deployment.md`, `README.md`, and this acceptance criteria file are present.
- **Sign-off:** Security Engineer and Ryan sign off before declaring the module live; record sign-off as an AuditEvent.

**How to verify:** Confirm docs exist and obtain written sign-off recorded in audit log.

---

## # Final acceptance statement
The Eval Engine & Resource Allocator module is accepted when all above criteria pass in a staging environment, automated tests are green, audit integrity is verified, SentinelNet policy checks function, Finance gates work for capital allocations, and formal sign-off by Ryan and the Security Engineer is recorded.

