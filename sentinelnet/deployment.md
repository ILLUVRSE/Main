# SentinelNet — Deployment & Infrastructure Guide

Purpose: operational, production-ready guidance for deploying SentinelNet, the real-time policy and enforcement engine. This document covers recommended infra, deployment patterns, low-latency architecture for synchronous checks, streaming for asynchronous detection, policy registry & rollout, signing and audit integration, remediation mechanisms, scaling, monitoring, CI/CD, and runbooks.

---

## # 1) High-level architecture
- **Policy API (low-latency)** — fast, stateless service that evaluates pre-action synchronous checks for Kernel and returns `allow|deny|quarantine|remediate|escalate`.
- **Policy Engine (worker fleet)** — background workers for heavier policy simulations, historical scans, anomaly detection, and batched enforcement.
- **Policy Registry** — Postgres-backed store of policies with versioning, tests, and status (`draft|sim|canary|active|deprecated`).
- **Audit/Event consumers** — Kafka/Redpanda subscription for consuming audit events and telemetry for asynchronous policy evaluation.
- **Remediation executor** — subsystem that issues enforcement actions (via Kernel/Agent Manager/Resource Allocator) and records results.
- **Signing & Key Management** — KMS/HSM for signing policy deployments and important decisions where required; signing proxy for safe access.
- **UI & CommandPad hooks** — policy authoring, simulation reports, manual review & overrides, ratification workflows (multisig).
- **Storage & archive** — S3 for simulation results, audit exports, and evidence snapshots.

---

## # 2) Infrastructure & provider choices
- **Kubernetes** for API and worker deployments (managed preferred).
- **Postgres** for Policy Registry (managed).
- **Kafka/Redpanda** for audit/event streaming.
- **S3** for storing long-running simulation results and evidence.
- **KMS/HSM** or cloud-managed HSM for key material.
- **Vault** for secrets.
- **Prometheus/Grafana & OpenTelemetry** for metrics and tracing.
- **Redis** optional for caching policy decisions and rule indexes.

---

## # 3) Deployment patterns
- **Namespaces:** `sentinelnet-api` (synchronous), `sentinelnet-workers` (async), `sentinelnet-admin` (UI).
- **Helm chart**: package services, ConfigMaps, NetworkPolicies, RBAC, HPAs, and PodDisruptionBudgets.
- **Replica config**: API nodes: min 3 with HPA (based on request rate and CPU); workers scaled by queue depth.
- **Leader election:** leader instances manage scheduled scans, remediation coordination, and policy canary orchestration. Use Kubernetes Lease API.
- **Pod security & network policies:** enforce deny-all default; API only accepts mTLS connections from Kernel and approved services.

---

## # 4) Synchronous check design (low-latency)
- **Goal:** p95 latency below Kernel SLO (define target, e.g., < 150ms).
- **Implementation:** lightweight rule evaluator compiled or precompiled into efficient structures; avoid heavy IO during check.
- **Cache & precomputation:** cache policy decisions for hot keys, precompute frequently used rule indices, and use in-memory stores for lookups.
- **Timeouts & fallbacks:** enforce hard timeout (e.g., 100–200ms). On timeout, default behavior must be safe (deny or escalate per policy). Log timed-out checks as audit events.
- **Request envelope:** Kernel sends canonicalized request (id, actor, action, timestamp, payload pointers). Avoid sending large payloads; use references to audit events when needed.

---

## # 5) Asynchronous & streaming evaluation
- **Consumer model:** workers consume audit topics, run heavier ML/heuristic detectors, and emit `policyCheck` events and remediation tickets.
- **Windowing & aggregation:** support time-windowed rules (e.g., rate over 5m, anomaly over 24h). Use stream-processing frameworks or worker jobs.
- **DLQ & retries:** failed evaluations go to DLQ for manual inspection. Implement backoff and idempotent processing.

---

## # 6) Policy Registry & rollout
- **Policy lifecycle:** draft → simMode → canary → active → deprecated.
- **Policy tests:** each policy must include unit and scenario tests that run in CI. Tests executed in simulation against recent audit data.
- **Canary rollout:** promote policy to a subset of divisions or percentage of traffic; monitor FP/FN and impact for a configured window before global activation.
- **Multisig gating:** changes to `critical` policies require multisig approval per multisig-workflow. The registry enforces gating.
- **Policy versioning:** support rollback to previous versions; keep immutable policy history.

---

## # 7) Remediation & enforcement
- **Remediation actions:** defined, idempotent, and pre-approved actions (revoke cert, isolate agent, reduce allocation, create incident). Actions must be reversible where possible.
- **Executor pattern:** remediation executor submits actions via Kernel or direct service APIs; waits for result and records outcome as `policyCheck` with `actionTaken`.
- **Safety controls:** remediation requiring infra changes or financial impact must require additional approvals or multisig.
- **Auditability:** every remediation action emits audit events and evidence.

---

## # 8) Explainability & evidence
- **Explain endpoint:** `GET /sentinel/explain/{policyCheckId}` returns rationale, evidence pointers (audit ids, metrics snapshots), rule path, and confidence. Keep payload sizes reasonable.
- **Evidence snapshots:** capture small, relevant evidence snapshots to S3 when necessary for audits. Link via pointers, not duplicate heavy payloads.

---

## # 9) CI/CD & testing
- **Policy CI:** lint & unit tests for policy language; simulate against sample audit slices.
- **Integration tests:** synchronous check correctness and latency; simulation test over historical data; remediation execution test with mocked infra.
- **Canary validation:** run canary in staging with real-like traffic and evaluate FP/FN metrics.
- **Security scans:** SAST/DAST for admin UI and signing proxy.

---

## # 10) Observability & SLOs
- **Metrics:** check latency (p50/p95/p99), decision counts, decision breakdown by policy, remediation success, simulation false-positive rates.
- **Tracing:** end-to-end traces for synchronous check: Kernel → SentinelNet → Kernel decision. Include rule evaluation spans.
- **Alerts:** high denial rate, high remediation failure, policy deploy failures, and evaluation worker backlogs.
- **SLOs:** synchronous check p95 target (e.g., <150ms). Define acceptable FP rate per policy and monitor.

---

## # 11) Scaling & performance
- **Scale horizontally:** API nodes behind load balancer; workers scale with Kafka consumer groups. Use Redis or in-memory caches for hot rule data.
- **Partitioning:** shard simulation jobs and large streaming scans by time range or entity hash.
- **Policy complexity limits:** enforce policy evaluation complexity caps to avoid slow checks.

---

## # 12) Security & signing
- **mTLS & RBAC:** API only accepts mTLS from Kernel; UI uses OIDC/SSO + 2FA. Policy edits and overrides restricted by role.
- **Signing:** policy activation or critical decisions may be signed by SentinelNet signer (KMS/HSM) to prove origin.
- **Key management & rotation:** follow governance rules; rotation events recorded in audit.

---

## # 13) Backups, DR & replay
- **Policy Registry backups:** regular Postgres backups and PITR; test restores.
- **Simulation archives:** save simulation runs and evidence to S3 for later analysis.
- **Replayability:** ability to re-run policies over archived audit events for impact analysis or after fixes.

---

## # 14) Runbooks (must exist)
- Slow synchronous checks runbook (diagnosis & mitigation).
- Policy rollout rollback runbook (if canary shows unacceptable false positives).
- Remediation failure & manual remediation runbook.
- Key compromise & signing proxy failover.
- Replay & re-evaluation of historical events runbook.

---

## # 15) Acceptance criteria (deployment)
- **Sync SLO:** synchronous checks respond within defined Kernel SLO (p95 target).
- **Correctness:** sample policies block or allow expected test cases and produce `policyCheck` audit events with rationale and evidence.
- **Simulation & canary:** policy simulation runs over historical data; canary promotion works and metrics available.
- **Remediation execution:** execute sample remediation (e.g., quarantine an allocation) and confirm recorded outcome and audit.
- **Explainability:** `GET /sentinel/explain/{policyCheckId}` returns structured rationale and evidence.
- **Security:** mTLS + RBAC enforced; multisig gating works for critical policy activations.
- **Observability:** metrics, tracing and alerts configured and tested.

---

## # 16) Operational notes & cost controls
- Use policy simulation to estimate false positives before global activation to reduce operational cost.
- Keep remediation action set small, auditable, and safe.
- Use managed services where possible to reduce ops burden (managed Kafka, managed Postgres, managed KMS/HSM).
- Monitor and cap simulation job cost (large historical scans are expensive); run heavy scans in off-peak windows.

---

End of file.

