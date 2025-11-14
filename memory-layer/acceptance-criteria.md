# Memory Layer — Acceptance Criteria

Use this checklist to verify the Memory Layer is production-ready. Each section maps to deployment, API, data integrity, security, and operations requirements.

## 1. Schema & data integrity
- ✅ `memory-layer/sql/migrations/001_create_memory_schema.sql` applied in dev/test/prod; repeat runs are idempotent.
- ✅ Tables exist with required constraints (`memory_nodes`, `artifacts`, `memory_vectors`, `audit_events`) and foreign keys enforce data ownership.
- ✅ Soft-delete columns (`deleted_at`) and legal hold flags persist correctly.
- ✅ Sample write/read round-trip proves JSONB metadata stored and retrieved without loss.

## 2. API behavior
- ✅ `POST /v1/memory/nodes` validates payloads, enforces idempotency, and emits audit events containing manifest signature + hash chain.
- ✅ `GET /v1/memory/nodes/:id` and `/artifacts/:id` respect RBAC and redact PII for unauthorized principals.
- ✅ `POST /v1/memory/search` executes semantic search with deterministic ordering for seeded vectors and supports metadata filter clauses.
- ✅ Health endpoints expose readiness (migrations applied + adapter reachable) and liveness (DB + adapter probes).

## 3. Embedding + vector pipeline
- ✅ On ingest, embeddings are written to the configured vector namespace and linked via `memory_node.embedding_vector_id`.
- ✅ Re-ingestion of identical content/key is idempotent (no duplicate nodes, audit record references original hash).
- ✅ Vector adapter falls back to queue if synchronous write fails and surfaces retries via metrics/logs.

## 4. Artifacts, provenance, and auditing
- ✅ Artifact metadata requires SHA256 + manifestSignatureId; checksum mismatch rejects request.
- ✅ Audit trail contains `hash`, `prev_hash`, `signature`, `memory_node_id/artifact_id`, and can be replayed to reconstruct state.
- ✅ Legal hold prevents deletion API/TTL job, and audits capture hold changes with reason.

## 5. Governance, security, and PII
- ✅ PII classification flags flow from ingest → storage → search output; unauthorized callers cannot view `piiFlags`.
- ✅ mTLS enforced; JWT scope verifies allowed operations (write vs read vs admin).
- ✅ Secrets (DB, vector, S3) pulled from secret manager at runtime; no secrets in repo/container image.

## 6. Observability and reliability
- ✅ Metrics emitted: ingestion rate, vector write latency, search latency p95, queue depth, audit failures.
- ✅ Distributed traces contain `memoryNodeId`, `traceId`, `caller`, and upstream correlation.
- ✅ Backup + restore drill: restore Postgres snapshot + vector snapshot + sample S3 object, then run search query to confirm parity.

## 7. QA + automation
- ✅ Integration tests cover ingest → vector write → search → artifact lookup, plus legal-hold + TTL scenarios.
- ✅ Load test demonstrates 95th percentile latency < target (documented in deployment guide) at expected QPS.
- ✅ Runbooks for incident response (failed vector writes, checksum mismatch, audit chain break) are documented and reviewed.
