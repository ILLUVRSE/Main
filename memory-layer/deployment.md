# Memory Layer — Deployment Guide

The Memory Layer is a multi-store subsystem (Postgres + Vector DB + S3) fronted by a lightweight Express API and worker pool. This guide walks through provisioning, configuration, rollout, and day-2 operations.

## 1. Baseline architecture
- **API surface:** `memory-layer/service/server.ts` (Express) handles CRUD/search endpoints, pushes async vector writes via the adapter, and emits audit events.
- **Postgres:** canonical metadata + audit store. Migrations live in `memory-layer/sql/migrations`.
- **Vector DB:** semantic index (Milvus, Pinecone, pgvector, etc.) used via `VectorDbAdapter`.
- **Object storage:** S3-compatible bucket for large artifacts and audit archives with retention/immutability controls.
- **Workers:** optional pool that consumes vector write/search warmup jobs when the adapter uses queued writes.

## 2. Environment + secrets
| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string with `verify-full` TLS. |
| `VECTOR_DB_ENDPOINT`, `VECTOR_DB_API_KEY`, `VECTOR_DB_NAMESPACE` | Adapter config. Namespace defaults to `kernel-memory`. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET`, `S3_REGION` | Artifact storage. Bucket must enable versioning + object-lock. |
| `AUDIT_KMS_KEY_ID`, `KMS_ENDPOINT` | Signing + verification for audit chain. |
| `SERVICE_ENV` | `dev`, `staging`, `prod` for namespacing metrics and indexes. |
| `PORT` | Express listen port (defaults to 4300). |

Secrets are sourced from Vault (`VAULT_ADDR`) or the platform secret manager; never bake them into images or configs.

## 3. Provisioning checklist

### 3.1 Postgres
1. Provision HA Postgres (>=14) with PITR enabled.
2. Run migrations in order:
   ```bash
   npx ts-node scripts/runMigrations.ts memory-layer/sql/migrations
   ```
   (or integrate into Flyway; files are pure SQL).
3. Configure parameters: `shared_buffers >= 25% RAM`, `wal_level = logical`, `max_wal_size >= 4GB`.
4. Enable hourly WAL archiving to resilient storage.
5. Networking: allow ingress only from Memory Layer services + BI role.

### 3.2 Vector DB
- Choose provider with ANN index + metadata filters (Milvus, Pinecone, pgvector).
- Create collection/index:
  ```
  name        : kernel-memory-${SERVICE_ENV}
  dimension   : match embedding model (e.g., 1536 for text-embedding-3-large)
  metric      : cosine
  replicas    : ≥2
  pods/segment: sized for 2x projected QPS
  ```
- Enable automatic snapshots nightly and store them in S3.
- Configure RBAC/API keys per environment; rotate quarterly.

### 3.3 Object storage
- Bucket: `illuvrse-memory-${SERVICE_ENV}`
- Settings: versioning ON, default encryption SSE-KMS, object-lock (compliance mode, 365 days) for audit archives.
- Lifecycle: move stale artifacts to Glacier after 90 days unless `legal_hold`.

### 3.4 Observability + queues
- Metrics pipeline (Prometheus, CloudWatch, etc.) must scrape the API + worker.
- If using queues for vector writes, provision the managed queue (SQS, Pub/Sub) and set `VECTOR_WRITE_QUEUE_URL`.

## 4. Deploying the service
1. Build container/image bundling `memory-layer/service` code plus migrations.
2. Inject env vars/secrets during deploy.
3. Apply migrations before each deploy (CI job or init container).
4. Start Express API (`node dist/memory-layer/service/server.js`) and worker(s).
5. Register readiness probes: `/healthz` (checks DB + adapter) and `/readyz` (ensures migrations applied).

## 5. Operational runbook
- **Backups:** daily snapshots + PITR for Postgres; nightly vector snapshots; weekly artifact integrity scans (recompute SHA256 and compare).
- **Disaster recovery:** rehearse failover quarterly by restoring Postgres snapshot + vector snapshot + S3 manifest, then reindex sample nodes.
- **Scaling:** vertical scale Postgres first (CPU bound), then add read replicas for analytics. Vector DB scales horizontally by pods; API horizontally by stateless replicas.
- **Legal hold:** set `legal_hold` boolean via API; scheduled cleaners honor this flag.
- **Rotation:** rotate API keys/KMS keys annually; re-encrypt stored secrets using new data keys.

## 6. Security guardrails
- Enforce mTLS between services; restrict security groups.
- Log every access (reads and writes) with caller/service id, memoryNodeId, and audit hash.
- Run `npm audit` + SAST in CI.
- Ensure compliance team has read-only replica with masked PII fields.

Following the above ensures the Memory Layer ships with hardened infra, predictable deployments, and repeatable recovery procedures.
