# Product & Development — Deployment & Infrastructure Guide

Purpose: operational guidance for tooling that supports idea capture, discovery, MVP execution, experiments, measurement, and handoff. This doc focuses on a secure, auditable, low-friction platform that enables rapid product cycles while preserving governance and traceability.

---

## 1) High-level architecture
- **Product API & UI** — lightweight services to submit ideas, manage sprints, register experiments, and run handoffs.  
- **Data & storage**:
  - **Postgres** for authoritative product records (ideas, sprints, experiments, MVPs).  
  - **Memory Layer** (already defined) for research artifacts, interview transcripts, and embedding/indexing.  
  - **S3** for artifacts (design files, recordings) with versioning and controlled access.  
- **Workflow engine** — durable workflow system (Temporal/Conductor) or job queue (Kafka + workers) for long-running flows (experiment lifecycle, handoff gating).  
- **Integration buses** — Kernel audit bus and event stream for auditability and cross-system triggers.  
- **Auth & Gateway** — Kernel for RBAC/signing; OIDC for human auth; mTLS for service integrations.

---

## 2) Required infrastructure & providers
- **Kubernetes** for hosting API/UI and workflow workers. Use managed clusters for production.  
- **Managed Postgres** for product data with backups and PITR.  
- **S3-compatible** storage for artifacts and recordings. Use object lock/versioning for audited assets.  
- **Kafka/Redpanda** for eventing and experiment telemetry streaming.  
- **Temporal (or alternative)** for durable workflows to manage experiment lifecycle and handoff sequences.  
- **Vault** for secrets and service credentials.  
- **Prometheus/Grafana & OpenTelemetry** for metrics and tracing.

---

## 3) Kubernetes deployment patterns
- **Namespace**: `product-dev`.  
- **Helm chart**: package API, UI, worker, cronjobs, ConfigMaps, and NetworkPolicies.  
- **Replicas & HPA**: API min 2 replicas; workers autoscale by queue depth.  
- **Pod security**: run non-root, restrict mounts, and apply NetworkPolicies denying egress except required services.

---

## 4) Workflow & long-running processes
- **Durable workflows**: use Temporal (or similar) for experiment lifecycle: create → enroll users → collect data → analyze → conclude → handoff. Durable workflows simplify retries, audits, and human approvals.  
- **Idempotency & correlation**: all callbacks and external events use stable ids for idempotent processing.  
- **Human approvals**: integrate CommandPad multisig flows for go/no-go handoffs and high-budget approvals.

---

## 5) Experimentation & telemetry
- **Instrumentation**: define a standard measurement plan schema (events, funnels, cohorts) and require instrumentation before experiments.  
- **Telemetry streams**: experiments push telemetry to Kafka; workers or analytics services compute experiment metrics and store canonical results in Memory Layer.  
- **Reproducible analysis**: store analysis scripts, seeds, and environment info as artifacts to allow reruns and verification.

---

## 6) Handoff & production gating
- **Handoff artifact**: handoff bundle includes manifest (features, infra plan, costs), measurement results, legal checklist, and pricing. The handoff triggers Kernel manifest registration.  
- **Multisig & governance**: handoffs that require budget or affect governance follow multisig workflow; Kernel coordinates and emits audit events.  
- **Post-handoff verification**: post-handoff smoke tests and acceptance criteria executed automatically before final production sign-off.

---

## 7) Security & compliance
- **PII**: restrict storage of PII in product tooling. If needed, store only pointers to Memory Layer artifacts with restricted access and SentinelNet checks.  
- **RBAC**: OIDC groups map to Product roles (ProductManager, Researcher, GrowthHacker, TechnicalLead). Enforce least privilege.  
- **Audit**: every experiment, decision, and handoff emits an AuditEvent via Kernel. Maintain exportable audit packages.

---

## 8) Observability & SLOs
- **Metrics**: ideas ingested, experiments started/completed, experiment duration, handoff latency, approval time, artifact upload latency.  
- **Tracing**: trace experiments end-to-end (instrumentation → telemetry → analysis → decision).  
- **Alerts**: long-running experiments stalled, approval backlogs, artifact upload failures.  
- **SLO examples**: handoff approval time p95 < X hours (configurable), experiment result availability within Y hours after experiment end.

---

## 9) CI/CD & testing
- **Pipeline**: lint → unit tests → integration tests (workflow and telemetry mocks) → deploy to staging → run acceptance tests.  
- **Policy tests**: ensure handoff gating, multisig, and SentinelNet policies are exercised in CI.  
- **Data governance**: tests must use synthetic/anonymized data; never use production PII in staging.

---

## 10) Backups, DR & retention
- **Postgres backups**: daily snapshots + PITR.  
- **Artifact retention**: artifacts archived with versioning; implement legal-hold when required.  
- **Replayability**: store canonical experiment data and analysis artifacts to support reruns and audits.

---

## 11) Runbooks (must exist)
- Experiment data failure & retry runbook.  
- Handoff approval slowdown & escalation runbook.  
- Artifact restore and replay runbook.  
- Emergency rollback of handoff manifest runbook (multisig-driven).

---

## 12) Acceptance criteria (deployment)
- **Idea & experiment flows**: submit idea → run discovery tasks → start experiment → collect telemetry → produce canonical results and store them.  
- **Handoff**: create handoff bundle and trigger Kernel manifest registration; multisig gating works for high-budget handoffs.  
- **Auditability**: each experiment and handoff emits AuditEvents and evidence stored in Memory Layer.  
- **Observability**: metrics and traces available; alerts configured for key failure modes.  
- **Security**: SentinelNet blocks a PII experiment launch without approval; PII evidence access restricted.

---

## 13) Operational notes & team guidance
- **Lean teams**: keep experiments small; prefer automated instrumentation and fast iterations.  
- **Experiment templates**: provide templates for common experiment types (A/B, pricing, onboarding) with pre-registered analysis scripts.  
- **Handoff checklist**: mandatory checklist for production handoff (infra, legal, metrics, budget). Automate as much as possible.

---

End of file.

