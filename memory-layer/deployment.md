# Memory Layer — Deployment

## Services
- Postgres (authoritative metadata), Vector DB (Milvus/HNSW/Pinecone), S3 (artifacts), Worker pool for vector writes.

## Config & env
- `DATABASE_URL`
- `VECTOR_DB_ENDPOINT` and credentials
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET`
- `KMS_URL` (for signature/verification)
- `VAULT_ADDR` for secrets

## Postgres
- Use strong instance with backups and PITR.
- Migrations via Flyway or `make migrate`.
- Indexes: `memory_nodes(created_at)`, `artifact(sha256)`.

## Vector DB
- High-availability cluster; replication and snapshot schedule.
- Provision an index per namespace `kernel-memory`.

## S3
- Enable versioning and object-lock for audit buckets; use SSE-KMS.

## Workers
- Scale workers by vector write throughput and tagging.

## Observability
- Metrics: ingestion rate, vector write latency, search p95.
- Tracing across ingestion → vector write → search.

## Backup & restore
- Postgres PITR tested; Vector DB snapshots to S3 and restore drill validated.

## Security
- Use Vault to deliver DB credentials to services.
- RBAC on Vector DB if supported.

