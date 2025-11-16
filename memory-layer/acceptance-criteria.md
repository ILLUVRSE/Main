# Memory Layer — Acceptance Criteria (Hardened)

Use this checklist to verify the Memory Layer is production-ready. Each section maps to deployment, API, data integrity, security, and operations requirements. This file has been updated to reflect strict audit-signing, transactional writes, queue fallback for vectors, and additional tooling.

---

## 1. Schema & data integrity
- ✅ `memory-layer/sql/migrations/001_create_memory_schema.sql` and `002_enhance_memory_vectors.sql` applied in dev/test/prod; repeat runs are idempotent.
- ✅ Tables exist with required constraints (`memory_nodes`, `artifacts`, `memory_vectors`, `audit_events`) and foreign keys enforce ownership.
- ✅ Soft-delete columns (`deleted_at`) and legal hold flags persist correctly.
- ✅ Sample write/read round-trip proves JSONB metadata stored and retrieved without loss.
- ✅ `memory_vectors` has `vector_data JSONB` and unique `(memory_node_id, namespace)` index to ensure idempotent writes.

## 2. API behavior & atomicity
- ✅ `POST /v1/memory/nodes` persists node + artifacts + an audit event **atomically** (single DB transaction). No node must exist without a corresponding audit entry for production flows.
- ✅ `POST /v1/memory/artifacts` validates artifact checksum and requires `manifestSignatureId` (or header fallback). On mismatch, request is rejected.
- ✅ `GET /v1/memory/nodes/:id` and `/v1/memory/artifacts/:id` respect RBAC and redact PII for unauthorized principals.
- ✅ `POST /v1/memory/search` executes semantic search with deterministic ordering for seeded vectors and supports metadata filter clauses.
- ✅ Health endpoints expose readiness (migrations applied + adapter reachable) and liveness (DB + adapter probes).

## 3. Audit & signing guarantees
- ✅ Audit events are canonicalized and a SHA-256 digest is computed deterministically for each event.
- ✅ Audit signing is **digest-path** (sign precomputed 32-byte SHA-256 digest) via:
  - AWS KMS (`AUDIT_SIGNING_KMS_KEY_ID`) — preferred, **or**
  - a signing proxy (`SIGNING_PROXY_URL`) — acceptable alternative, **or**
  - controlled local signing key (`AUDIT_SIGNING_KEY` / `AUDIT_SIGNING_PRIVATE_KEY`) only as emergency fallback.
- ✅ In `NODE_ENV=production` or when `REQUIRE_KMS=true`, the service **fails to start** if no signer is configured.
- ✅ `insertAuditEvent` and transactionally-coupled writes (e.g., `insertMemoryNodeWithAudit`) fail and rollback if signing fails; production image must never emit unsigned audit rows.
- ✅ Audit rows contain `hash`, `prev_hash`, `signature`, `manifest_signature_id` and are replayable to reconstruct state.

## 4. Artifact & provenance
- ✅ Artifact metadata requires `sha256` and `manifestSignatureId` on writes.
- ✅ `POST /v1/memory/artifacts` computes SHA-256 by streaming the object (S3 or HTTP) and rejects if mismatch.
- ✅ Artifact rows include checksum and are linked to an audit event that is signed.
- ✅ Audit archive exports are written to `illuvrse-audit-archive-${ENV}` with Object Lock (COMPLIANCE) and lifecycle policy; DR restore drill documented.

## 5. Embedding + vector pipeline
- ✅ On ingest, embeddings are written to the configured vector namespace and linked via `memory_node.embedding_id` or `memory_vectors.external_vector_id`.
- ✅ Re-ingestion of identical content/key is idempotent (unique `(memory_node_id, namespace)` constraint prevents duplicates).
- ✅ For external vector providers: adapter attempts provider write; on failure it **enqueues** a pending `memory_vectors` row (`status='pending'`) for worker replay (queue fallback enabled by `VECTOR_WRITE_QUEUE=true`).
- ✅ `vectorWorker` processes `memory_vectors` with `FOR UPDATE SKIP LOCKED`, marks success or error, and updates `external_vector_id` on success.
- ✅ Search SLO: seeded vectors return deterministic ordering; unit/integration verifies p95 search latency target.

## 6. TTL / legal-hold / deletion
- ✅ TTL cleaner exists and runs periodically, soft-deletes expired nodes, and writes a signed `memory.node.deleted` audit event **inside the same transaction**.
- ✅ Legal hold prevents TTL deletion and API delete; audit captures legal-hold changes with reason.

## 7. Governance, security, and PII
- ✅ PII classification flags flow from ingest → storage → search output; unauthorized callers cannot view `piiFlags`.
- ✅ mTLS enforced (when configured) and JWT scope verifies allowed operations (write vs read vs admin).
- ✅ Secrets (DB, vector, S3, KMS credentials or signing-proxy API keys) are pulled from Vault or platform secret manager at runtime; no secrets in repo or images.

## 8. Observability, reliability & ops
- ✅ Metrics emitted: ingestion rate, vector write latency, search latency p95, vector queue depth, audit sign failures.
- ✅ Distributed traces include `memoryNodeId`, `traceId`, `caller`, and upstream correlation forwarded into audit payloads when available.
- ✅ Health checks: `/healthz` and `/readyz` implemented; readiness checks include migrations and vector adapter.
- ✅ Backups & DR: Postgres PITR, nightly vector snapshots, object-lock audit archives + quarterly restore drill documented.

## 9. QA & automation
- ✅ Integration tests cover ingest → transactional audit write → vector write (queue fallback) → search → artifact lookup → TTL / legal-hold. Tests reside under `memory-layer/test/integration`.
- ✅ `memory-layer/scripts/runMigrations.ts` supports CI migration runs before tests/deploy.
- ✅ Tools exist and are exercised:
  - `memory-layer/service/audit/verifyTool.ts` — verifies audit chain + signatures
  - `memory-layer/service/audit/kmsAdapter.ts` — KMS adapter for signing/verify
  - `memory-layer/tools/auditReplay.ts` — replay audit exports into staging
- ✅ CI pipeline runs migration + integration tests against ephemeral Postgres and reports green on main.

## 10. Runbook & signoff
- ✅ Security signoff: Security Engineer must approve KMS/HSM usage, signing proxy exposure, PII handling, and multisig workflows.
- ✅ Operational runbook (start, stop, recover, DR drill steps) documented in `memory-layer/deployment.md`.
- ✅ Final sign-off recorded via a signed audit event by the named approver.

---

When all the items above are green, the Memory Layer is considered functionally complete, auditable, and operable for frontend teams to build against.

