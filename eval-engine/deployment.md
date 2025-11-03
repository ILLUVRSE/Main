# Eval Engine & Resource Allocator — Deployment & Infrastructure Guide

Purpose: operational guidance for deploying the Eval Engine (scoring, recommendations, retraining orchestration) and the Resource Allocator (compute/capital assignment). Focused on production patterns: infra, security, scaling, CI/CD, observability, and runbooks.

---

## # 1) High-level architecture
- **Eval Engine (stateless + workers)**: stateless API servers for ingestion/queries and scalable worker fleet for scoring, aggregation, and backtests.
- **Resource Allocator (service)**: authoritative service enforcing allocation lifecycle, quota accounting, and orchestration of apply/preempt actions.
- **State stores**: Postgres for authoritative records (scores, events, allocations), Redis for ephemeral caches and leader-election, Kafka/Redpanda for event ingestion and streaming.
- **AI infra**: GPU pools, job orchestration (K8s, Ray, or Slurm) for retrain jobs.
- **Integration**: Kernel (RBAC/audit), SentinelNet (policy checks), Reasoning Graph (explainability), Finance (ledger checks), Agent Manager (apply allocations).

---

## # 2) Required infra & recommended providers
- **Kubernetes** for APIs and workers. Use multi-AZ clusters for resilience.
- **Postgres** (managed) for persistent state; replicas for HA and read-scaling.
- **Redis** for caching, leader election, and rate-limiting.
- **Kafka/Redpanda** for event ingestion (eval reports, telemetry) and for streaming to downstream consumers.
- **Object storage (S3)** for retrain artifacts and model outputs.
- **GPU nodes / AI infra**: dedicated GPU node pools or managed ML infra (e.g., Vertex AI, Sagemaker/Ray clusters).
- **Vault / Secrets Manager** for dynamic credentials.
- **KMS/HSM** to sign important promotion/allocation records when required.

---

## # 3) Kubernetes deployment patterns
- **Helm chart** with Deployments for API servers, worker deployments for scoring/retrain orchestration, ConfigMaps, Secrets (mounted via Vault), and RBAC.
- **Leader election** for coordination tasks (allocation reconciler, promotion aggregator) using Kubernetes Lease API.
- **Replica counts & HPA**: API servers: min 2 replicas; workers autoscale based on queue depth.
- **PodDisruptionBudget**: set to maintain availability during upgrades.
- **Init containers & migrations**: run DB migrations as a job before rolling upgrades.

---

## # 4) Eventing & ingestion
- **High-throughput ingestion**: clients (Kernel, Agent Manager) write EvalReports to Kafka; Eval Engine consumers read, process, and persist.
- **Exactly-once / idempotency**: use idempotency keys and consumer offsets + transactional writes into Postgres where feasible.
- **Backpressure**: if workers lag, return accepted/queued responses and expose queue depth metrics to drive autoscaling.

---

## # 5) Scoring & compute
- **Workers**: separate worker types for real-time scoring, batch recompute, and offline backtests.
- **Batching & windows**: scoring workers aggregate sliding-window metrics (1h/24h/7d) and compute normalized scores.
- **Retrain orchestration**: retrain jobs run on GPU clusters; resource booking goes through Resource Allocator and Finance if capital/time costs apply.
- **Model artifacts**: store retrain outputs to S3 with checksums and manifest records in Postgres.

---

## # 6) Resource allocation & enforcement
- **Pools & quotas**: configure pools (gpus-us-east, cpu-highmem) with defined capacities and quotas per division.
- **Transactional apply**: allocation apply must be transactional: reserve in accounting → request infra (k8s, cloud) → confirm → emit audit. If any step fails, rollback the reservation.
- **Preemption policy**: implement graceful preemption (notify, drain, migrate workloads where possible) and emit audit events for reclamation.
- **Finance integration**: capital allocations (money) must reconcile with Finance ledger before `applied`. For large allocations require multi-sig.

---

## # 7) Security & governance
- **mTLS**: all inter-service calls authenticated via mTLS; Kernel must be able to call Eval/Allocator securely.
- **RBAC**: Kernel governs human actions; services map identities to roles.
- **Audit & signing**: promotion/ allocation records are emitted as AuditEvents and signed (via KMS) for immutability.
- **Secrets**: fetch from Vault; never write secrets to logs or DB.
- **Policy enforcement**: call SentinelNet before applying allocations and for critical promotion decisions.

---

## # 8) Observability & SLOs
- **Metrics**: ingestion rate, processing latency, scoring latency, promotion events/sec, allocation request latency, allocation apply success rate, retrain job queue length.
- **Tracing**: propagate trace IDs end-to-end (ingest → score → promote → allocate → apply).
- **Dashboards & alerts**: monitor worker lag, unusual promotion rates, allocation failures, buffer/backlog.
- **SLO examples**: scoring p95 < 200ms (real-time path), allocation apply within median X seconds (depends on infra), retrain job queue wait < acceptable threshold.

---

## # 9) CI/CD & release strategy
- **Pipeline**: lint + unit tests → build image → security scanning → integration tests (ephemeral infra) → deploy to staging → run acceptance tests → canary → full production rollout.
- **Multi-sig gating**: changes to allocation enforcement, budget rules, or Finance hooks require multisig approval per governance.
- **Feature flags**: use feature flags for new scoring logic and canary promotions; allow rollback without DB migration.

---

## # 10) Backups, DR & replay
- **Postgres backups**: daily snapshots + WAL archiving for PITR.
- **Kafka retention & archive**: keep topic retention and archive to S3 for replay.
- **Replay capability**: ability to replay EvalReports from Kafka or archive to re-run scoring and recompute leaderboards. Replay must be idempotent and verifiable.
- **DR drills**: periodically restore Postgres and run scoring on a sample dataset to validate.

---

## # 11) Testing & validation
- **Unit tests** for scoring logic, normalization, hysteresis, and promotion rules.
- **Integration tests** for end-to-end promotion → allocation → apply flows, with SentinelNet policy simulation.
- **Load tests** for ingestion throughput, scoring latency, and queue saturation.
- **Chaos tests**: simulate infra failures (K8s node loss, Kafka lag, Postgres failover) and validate safe behavior and audit completeness.

---

## # 12) Runbooks (must exist)
- Scoring pipeline backfill runbook.
- Allocation reconciliation and conflict resolution.
- Preemption handling runbook.
- Retrain job failure and retry runbook.
- Emergency revoke of allocations (multi-sig) and rollback procedure.

---

## # 13) Acceptance criteria (deployment)
- Eval Engine deployed and healthy in staging with Kafka + Postgres + Redis connected.
- End-to-end ingestion and scoring for synthetic EvalReports verified.
- Promotion → allocation → apply flow validated with SentinelNet policy blocking and Finance reconciliation tested.
- Retrain orchestration executes a mock retrain job and records results.
- Audit events emitted for promotions/allocations with verifiable signatures.
- Monitoring, tracing, and alerts configured and tested.

---

## # 14) Operational notes & cost considerations
- **Cost controls**: keep retrain and GPU usage under budget via quotas and booking policies.
- **Autoscaling tuning**: tune HPA for worker types based on queue depth and latency targets.
- **Model retrain costs**: schedule large retrains in off-peak windows and use spot instances where suitable.
- **FinOps**: track allocation costs per division and export monthly reports to Finance.

---

End of file.

