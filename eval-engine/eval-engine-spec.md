# Eval Engine & Resource Allocator — Specification

## # Purpose
The Eval Engine continuously scores agents, divisions, and products; issues promotion/demotion recommendations; and provides the metrics and signals the Resource Allocator uses to assign compute and capital. The Resource Allocator is the enforcement/execution component that applies allocations based on Eval recommendations, policy, and budget.

This document covers both pieces together because they are tightly coupled: Eval produces signals, Resource Allocator executes them under governance.

---

## # Core responsibilities

## # Eval Engine
- Ingest EvalReports and telemetry (metrics, logs, experiment results).
- Compute normalized scores and composite KPIs for agents/divisions over configurable windows.
- Run rules and ML models to generate promotion/demotion recommendations and predicted ROI.
- Produce PromotionEvents / DemotionEvents / RetrainJobs with rationale and confidence.
- Emit audit events for recommendations and promotion actions.
- Provide APIs for querying agent/division scoreboard and historical metrics.
- Support offline backtests, A/B evaluation, and canary experiments.
- Integrate with Memory Layer and Reasoning Graph to store traces and explainability metadata.

## # Resource Allocator
- Accept allocation requests (from Kernel or Eval Engine) and apply compute/capital changes subject to policy, quotas, and SentinelNet checks.
- Maintain pools (compute pools, budgets) with quotas and usage accounting.
- Support request lifecycle: `requested → pending → approved/applied → confirmed` (or `rejected`).
- Enforce budget caps, priority, and mission weighting.
- Emit signed audit events for allocations.
- Support preemption rules and eviction policies when reclaiming resources.

---

## # Minimal public interfaces (intents)

## # Eval Engine APIs (Kernel-authenticated)
- `POST /eval/submit` — ingest EvalReport (agentId, metricSet, timestamp, source).
- `GET  /eval/agent/{id}/score` — get agent current score & history.
- `GET  /eval/scoreboard?divisionId=&topK=` — leaderboard for a division.
- `POST /eval/promote` — create PromotionEvent (agentId/divisionId, rationale, confidence, requestedBy). Used by Eval or manual.
- `POST /eval/retrain` — create RetrainJob (model refs, dataset refs, priority).
- `GET  /eval/jobs/{id}` — fetch retrain job status.

## # Resource Allocator APIs (Kernel-authenticated)
- `POST /alloc/request` — request allocation change (entityId, pool, delta, reason, idempotencyKey).
- `GET  /alloc/{id}` — fetch allocation status.
- `POST /alloc/approve` — approve pending allocation (used by automated policies or by Kernel).
- `POST /alloc/reject` — reject request with rationale (policyId).
- `GET  /alloc/pools` — list pools and usage/quotas.
- `POST /alloc/preempt` — request preemption of resources from lower-priority entities.

**Notes:** All mutate operations emit audit events and are subject to SentinelNet policy checks before state change.

---

## # Canonical data models (short)

## # EvalReport
- `id`, `agentId`, `metricSet` (json), `timestamp`, `source`, `window` (optional), `tags`.

## # AgentScore
- `agentId`, `score` (numeric), `components` (breakdown per metric), `computedAt`, `window`, `confidence`.

## # PromotionEvent
- `id`, `entityId` (agent/division), `action` (`promote|demote|hold`), `rationale` (text), `confidence`, `requestedBy`, `status` (`pending|approved|applied|rejected`), `ts`.

## # RetrainJob
- `id`, `modelFamily`, `datasetRefs[]`, `priority`, `status` (`queued|running|done|failed`), `resultMetrics`, `ts`.

## # AllocationRecord
- `id`, `entityId`, `pool`, `delta`, `reason`, `requestedBy`, `status` (`pending|applied|rejected`), `ts`, `appliedBy`, `appliedAt`.

---

## # Scoring & decision rules (principles)
- **Configurable score composition:** scores are weighted aggregates of normalized metrics (e.g., success rate, latency, cost-efficiency). Weights are configurable per division and time-window.
- **Normalization & windows:** normalize metrics to comparable scales; compute sliding-window aggregates (e.g., last 1h, 24h, 7d).
- **Confidence & variance:** provide confidence intervals; low-confidence results require manual review before major allocations.
- **Explainability:** each score must produce a breakdown (component contributions) and a short textual rationale for recommendations. These go to the Reasoning Graph.
- **Promotion thresholds:** promotions/demotions are triggered based on configured thresholds + policy checks; allow hysteresis to avoid oscillation (e.g., require sustained score > threshold for N windows).
- **A/B & canary evaluation:** allow Eval to run candidate promotions in canary mode (limited allocation) and compare ROI before full apply.

---

## # Promotion & allocation flow (typical)
1. **Eval ingest:** Eval reports flow in via `/eval/submit`.
2. **Score compute:** Eval Engine recomputes agent/division scores and updates scoreboard.
3. **Recommendation:** If score passes promotion criteria, Eval emits a PromotionEvent (rationale + confidence) and records it to Reasoning Graph and Audit.
4. **Allocation request:** Either Eval requests allocation directly (`/alloc/request`) or Kernel triggers an allocation flow using the PromotionEvent.
5. **Policy check:** Resource Allocator calls SentinelNet to validate policy (budget cap, pool quota, mission constraints).
6. **Approval/apply:** If SentinelNet approves and budget allows, Resource Allocator applies allocation, updates AllocationRecord to `applied`, and emits audit. If blocked, `rejected` with `policyId`.
7. **Post-apply validation:** Run canary jobs or monitor Eval signals; on failure, Resource Allocator may preempt allocation and emit demotion/rebalance events.

---

## # Integration & governance
- **Kernel as gatekeeper:** Kernel validates RBAC and records audit events for all promotions and allocations.
- **SentinelNet policy enforcement:** Any allocation must pass SentinelNet checks. SentinelNet may block, quarantine, or require manual multi-sig approval.
- **Reasoning Graph:** Every promotion, allocation, and retrain job writes nodes/traces for explainability.
- **Finance tie-in:** For capital allocations, Resource Allocator must integrate with Finance to ensure budgets and ledger entries before applying changes.

---

## # Audit & immutability
- Every PromotionEvent, RetrainJob, and AllocationRecord is recorded as an AuditEvent (hash + signature).
- Promotion decisions and allocation changes must be verifiable via audit chain.
- RetrainJob results (metrics) and promotion outcomes are kept for model evaluation and A/B analysis.

---

## # Safety & guardrails
- **Budget caps:** enforce per-division and global caps; requests exceeding cap are rejected or sent for escalation.
- **Quota & pool limits:** pools have hard limits (e.g., GPUs available). Requests beyond capacity return pending or rejected.
- **Hysteresis:** require sustained signals for promotions; protect against oscillations.
- **Cooldown & rate limits:** limit how often an entity can request allocations or promotions.
- **Canary windows:** allow partial allocations first, with evaluation, before full apply.

---

## # Retraining & self-improvement
- **Retrain jobs:** Eval Engine can propose RetrainJob with dataset refs derived from traces and high-performing examples.
- **Approval & resource request:** retrain jobs require resource reservations (GPU hours) via Resource Allocator and may require budget approval.
- **Promotion of models:** When retrain results are positive, Eval proposes model promotion events recorded in Reasoning Graph and signed via Kernel.

---

## # Observability & metrics
- **Metrics to export:** eval ingestion rate, scoring latency, promotion events/sec, allocation request latency, allocation success rate, preemption events, retrain job queue length.
- **Traces:** propagate request IDs and trace IDs through Eval → Allocator → Kernel → SentinelNet for full debugging.
- **Dashboards:** score distributions, top movers, allocation failures by policy id, retrain job health.

---

## # Deployment & infra notes (brief)
- Eval Engine: stateless compute nodes + persistent Postgres for state and Redis for short-term caches + Kafka for event ingestion. Retrain jobs run on AI infra GPU pools.
- Resource Allocator: service that interacts with infra controllers (Kubernetes, cluster APIs) to request/adjust compute and with Finance for capital. Use transactional patterns for apply steps.
- Prefer running Eval Engine as scalable workers with autoscaling based on ingestion queue depth.

---

## # Testing & acceptance criteria (minimal)
- **Eval ingestion:** `POST /eval/submit` accepts reports and updates scoreboard.
- **Score correctness:** compute scores for synthetic inputs and verify expected outputs & component breakdown.
- **Promotion path:** Eval emits PromotionEvent when threshold met; Resource Allocator applies allocation when policy allows.
- **Policy enforcement:** SentinelNet blocks a test allocation and Resource Allocator returns `403` with `policyId`.
- **Hysteresis & canary:** promotions require sustained high score and canary allocation behaves as expected.
- **Audit:** PromotionEvent and AllocationRecord produce audit events with verifiable hash/signature.
- **Retrain flow:** create retrain job, allocate resources, and run a mocked retrain that reports result metrics; Eval picks up results and can promote model.

---

## # Security & compliance
- RBAC and mTLS for all interactions. Kernel must gate sensitive operations.
- Budget and finance checks for capital allocations; sensitive allocation actions require multi-sig per governance.
- Auditability and signed records for every promotion/allocation event.

---

## # Example flow (short)
1. Agent `A` yields strong metrics; Eval computes score 0.92.
2. Eval emits `PromotionEvent(agent=A, action=promote, confidence=0.9)`.
3. Resource Allocator receives request and checks pool `gpus-us-east`. SentinelNet approves. Finance confirms budget. Allocation applied: `+1 GPU`. Audit events emitted.
4. Post-apply, Eval monitors ROI; if ROI negative over window, Eval emits DemotionEvent and Resource Allocator preempts GPU.

---

End of file.

