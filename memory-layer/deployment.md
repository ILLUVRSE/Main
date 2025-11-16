# Memory Layer — Deployment Guide (Hardened)

This document describes how to provision, configure, and operate the Memory Layer service.
It has been updated to reflect strict audit-signing guardrails, Vector DB queue fallback, and operational runbooks.

---

## 0. Summary / Intent

Memory Layer is a multi-store subsystem (Postgres + Vector DB + S3) fronted by an Express API and worker pool. Production must ensure:

- Audit chain signing is always available and enforced (KMS, signing proxy, or a controlled local key only as fallback).
- Audit events are canonicalized and signed before any state-changing operation commits.
- Artifacts stored in S3-compatible storage with object-lock for audit archives.
- Vector writes are idempotent and queued for replay on failure.
- TTL/Legal-hold behavior supported by scheduled job(s).

---

## 1. Required Components

- **Postgres** (>= 14, PITR enabled) — canonical metadata + audit store.
- **Vector DB** (Milvus / Pinecone / pgvector / custom) — ANN index for embeddings.
- **Object storage** (S3 or S3-compatible like MinIO) — artifacts + audit archive with object-lock.
- **KMS / Signing Service** — AWS KMS or a signing proxy/HSM to sign audit digests.
- **Workers** — vector worker + TTL cleaner.
- **Secrets manager** — Vault or platform secret manager for runtime secrets.

---

## 2. Environment variables (key ones)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `VECTOR_DB_PROVIDER` | `postgres` (default) or provider name |
| `VECTOR_DB_ENDPOINT` | Vector provider endpoint (optional) |
| `VECTOR_DB_API_KEY` | Vector provider API key (if applicable) |
| `VECTOR_DB_NAMESPACE` | Namespace for vectors (default `kernel-memory`) |
| `VECTOR_WRITE_QUEUE` | `true` to enable DB queue fallback for external provider writes |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET` | S3 or MinIO config |
| `AUDIT_SIGNING_KMS_KEY_ID` | Preferred: AWS KMS KeyId/ARN for signing |
| `SIGNING_PROXY_URL` | Optional: remote signing proxy endpoint |
| `AUDIT_SIGNING_KEY` / `AUDIT_SIGNING_SECRET` / `AUDIT_SIGNING_PRIVATE_KEY` | Local-signing fallback (not for prod unless managed) |
| `REQUIRE_KMS` | If `true`, service refuses start when no signer is configured |
| `NODE_ENV` | `production`/`staging`/`dev` — production enables strict guards |
| `PORT` | Service port (default 4300) |

**Startup signing guard**  
On startup, the service performs a conservative check: if `NODE_ENV=production` **or** `REQUIRE_KMS=true`, at least one of the following must be configured:

- `AUDIT_SIGNING_KMS_KEY_ID` (preferred—AWS KMS)
- `SIGNING_PROXY_URL` (centralized signing/HSM proxy)
- `AUDIT_SIGNING_KEY` / `AUDIT_SIGNING_SECRET` / `AUDIT_SIGNING_PRIVATE_KEY` (local key fallback)

If none present, the service exits with a clear error message. This prevents unsigned audit events in production.

---

## 3. Postgres provisioning & migrations

- Provision HA Postgres (>=14) with PITR and WAL archiving.
- Run migrations via:
  ```bash
  DATABASE_URL=... npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations
  ```

* Important tables: `memory_nodes`, `memory_vectors`, `artifacts`, `audit_events`, `schema_migrations`.
* Ensure `pgcrypto` extension is enabled (migrations create it).
* Use role grants / RLS so only service role can mutate; auditors have read-only views.

---

## 4. Vector DB provisioning

* Choose a provider with ANN + metadata filtering (Milvus, Pinecone, pgvector).
* If using `postgres` provider (dev): production must use a proper ANN provider.
* Vector collection config:

  * name: `kernel-memory-${SERVICE_ENV}`
  * dimension: match embedding model (e.g. 1536)
  * metric: cosine
  * replicas: ≥2
* Enable nightly snapshots to S3 and configure autoscaling.
* If external provider is used, `VECTOR_WRITE_QUEUE` may be enabled to queue writes when provider is unavailable (adapter will enqueue rows into `memory_vectors` with `status='pending'`).

---

## 5. Object storage (S3 / MinIO)

* Primary artifact bucket: `illuvrse-memory-${SERVICE_ENV}`
* Audit archive bucket: `illuvrse-audit-archive-${SERVICE_ENV}` — **Object Lock (COMPLIANCE)** enabled.
* Settings:

  * Versioning ON, SSE-KMS encryption, Object Lock (COMPLIANCE), default retention >= 365 days.
  * IAM: `memory-layer-writer` role allowed to `PutObject`/`PutObjectLegalHold` but not delete.
  * Bucket policy: deny `s3:DeleteObject*` unless called by `audit-admin` with MFA.
* Run the restore & checksum drill quarterly (see *DR drills* below).

---

## 6. KMS / signing

* Preferred: AWS KMS asymmetric or HMAC keys.
* If using KMS:

  * Set `AUDIT_SIGNING_KMS_KEY_ID`.
  * Use digest semantics (sign the 32-byte SHA-256 digest).
  * Rotate keys per policy and restrict access to signing roles.
* Alternative: Signing proxy that provides `/sign/hash` and `/verify` endpoints. If used, set `SIGNING_PROXY_URL` and secure it (mutual TLS / API key).
* **Never** commit private keys in the repo or bake into images. Use secrets manager.

---

## 7. Worker processes

* **vectorWorker**

  * Processes `memory_vectors` rows with `status != 'completed'` using `FOR UPDATE SKIP LOCKED`.
  * Config via `VECTOR_WORKER_INTERVAL_MS` and `VECTOR_WORKER_BATCH_SIZE`.
  * Should run as a Deployment/Job; multiple replicas allowed.

* **ttlCleaner**

  * Periodic job that soft-deletes expired `memory_nodes` (honors `legal_hold`) and writes a signed `memory.node.deleted` audit event inside the same DB transaction.
  * Config via `TTL_CLEANER_INTERVAL_MS` and `TTL_CLEANER_BATCH_SIZE`.

---

## 8. Health & readiness

* `/healthz` — checks DB and vectorAdapter.healthCheck()
* `/readyz` — verifies migrations applied and adapter warmed
* Add liveness/readiness probes in k8s to hit these endpoints.

---

## 9. Backup & DR

* Postgres daily snapshots + PITR.
* Vector nightly snapshots to S3 (same lifecycle as artifacts), and a tested restore path.
* Audit archives stored in `illuvrse-audit-archive-*` with object-lock and cross-region replication.
* **Quarterly DR drill**:

  1. Select a random archived audit object.
  2. Restore and verify SHA-256 and signature.
  3. Replay via `memory-layer/tools/auditReplay.ts` into staging DB.
  4. Verify audit chain parity and artifact existence.

---

## 10. CI / Local dev

* CI must run `npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations` before running integration tests.
* For local dev:

  * `NODE_ENV=development` allows a local signing key via `AUDIT_SIGNING_KEY` or bypass via `X-Local-Dev-Principal` header.
  * To simulate KMS locally, set `SIGNING_PROXY_URL` to a local signer or provide `AUDIT_SIGNING_KEY`.
* Integration tests expect `DATABASE_URL` and run the migrations.

---

## 11. Operational runbook highlights

* Incident: audit signing failures → service startup fails or audit insert fails. Check KMS connectivity, key rotation, and `REQUIRE_KMS` flag.
* Incident: vector DB desync → run `vectorWorker` replay and compare counts between Postgres (`memory_vectors`) and Vector DB collection count.
* Incident: S3 corruption → restore from audit archive and run `memory-layer/tools/auditReplay.ts` to reconstruct state for staging.
* Security: enforce mTLS for signing proxy and service-to-service calls where feasible.

---

## 12. Notes & references

* CLI/tools:

  * `memory-layer/scripts/runMigrations.ts`
  * `memory-layer/service/worker/vectorWorker.ts`
  * `memory-layer/service/jobs/ttlCleaner.ts`
  * `memory-layer/service/audit/verifyTool.ts`
  * `memory-layer/tools/auditReplay.ts`
* Acceptance criteria: `memory-layer/acceptance-criteria.md`

---

