# Memory Layer — Deployment & Infrastructure Guide

Purpose: practical, operational instructions for deploying the Memory Layer (Postgres, Vector DB, S3 artifacts, embedding pipeline) in a secure, scalable, and auditable way. This is focused and implementation-ready.

---

## # 1) High-level architecture
- **Postgres** — authoritative relational store (divisions, agents, memory_nodes metadata, manifests, audit pointers).
- **Vector DB** — Milvus/Pinecone/Weaviate for storing embeddings and performing nearest-neighbor search.
- **Object Storage (S3)** — artifacts, model binaries, audit archives, embedding snapshots. Enable versioning + object lock for audit buckets.
- **Embedding Worker(s)** — stateless workers that preprocess documents, call embedding model, and write vector + metadata. Use a queue (Kafka/SQS) for work.
- **API / Service Layer** — exposes create/get/search memory APIs; enforces RBAC and emits audit events via Kernel.
- **Backup & Archive** — scheduled Postgres backups, vector snapshots, daily audit archive to S3.

Diagram:
`Clients/Agents → Memory API → (Postgres, Vector DB, S3, Embedding Workers → Vector DB)`
Audit events → Kafka → S3 archive + Postgres index

---

## # 2) Required infra & recommended providers
- **Kubernetes cluster** (for API, workers).
- **Postgres** (managed: RDS/Cloud SQL/AzureDB) with replicas and PITR support.
- **Vector DB**: Pinecone (hosted) or self-hosted Milvus on K8s (use operator). Choose Pinecone for fast bootstrap.
- **S3-compatible storage**: AWS S3, GCS, or MinIO (on-prem). Enable bucket versioning and object lock for audit buckets.
- **Queue**: Kafka/Redpanda (preferred), or managed pub/sub. Use for embedding jobs and event streaming.
- **Vault / Secrets Manager**: dynamic secrets and envelope keys.
- **Monitoring**: Prometheus + Grafana, OpenTelemetry tracing.
- **CI/CD**: GitHub Actions / GitLab CI + ArgoCD/Flux for GitOps or Helm deploys.

---

## # 3) Kubernetes deployment patterns
- **Namespace**: `illuvrse-memory` per environment.
- **Helm chart**: include Deployments for API + workers, ConfigMaps, Secrets (sourced from Vault), HorizontalPodAutoscaler, Service, and NetworkPolicy.
- **Stateful vs stateless**: Memory API/workers are stateless; Postgres is managed or stateful set with backups; Vector DB may be stateful and requires proper storage class.
- **Leader election**: for tasks that require single-writer semantics to avoid race conditions in provenance creation. Use Lease API.
- **Liveness/readiness**: API should check connectivity to Postgres and Vector DB; workers should check queue connectivity.

---

## # 4) Networking & security
- **mTLS & service auth**: Kernel calls Memory API via mTLS; validate CN and map to service identity. Use service mesh or sidecar if needed.
- **Network policies**: deny-all default; explicitly allow API → Postgres, API → Vector DB, API → S3, workers → embedding model endpoint.
- **Encryption**: TLS for all in-transit connections; enable at-rest encryption for Postgres, Vector DB, and S3.
- **RBAC**: Memory API enforces Kernel-driven RBAC. Kernel issues delegated tokens if agents need direct access.
- **Secrets**: inject via Vault CSI or similar; never commit secrets or write them to logs.

---

## # 5) Embedding pipeline & workers
- **Queue-driven design**: Producers (API or agents) enqueue documents; embedding workers consume batches, preprocess, call embedding model, and write vectors to Vector DB and metadata to Postgres.
- **Batching**: batch small items to improve throughput; tune batch size to model throughput and latency.
- **Model selection & versioning**: record embedding model name + version in metadata. Re-embedding jobs should be able to target a specific model version.
- **Retries & dead-letter**: use DLQ for failed embedding jobs; manual inspection required for DLQ items.
- **Idempotency**: use content checksum to avoid duplicate embeddings. Workers check checksum before writing.

---

## # 6) Data consistency & joins
- **Write ordering**: ensure the write pattern either (A) write Postgres metadata first with placeholder embeddingId then update after vector write, or (B) perform atomic-like pattern: insert metadata only after vector write returns id. Design for eventual consistency and provide a short-lived "pending" state.
- **Materialized view**: create materialized views for common joins (vector hits + title/owner/snippet) to speed up search results. Refresh intervals depend on freshness requirements.

---

## # 7) Backups, snapshots & replay
- **Postgres**: enable daily snapshots + WAL archiving for PITR. Test restores regularly.
- **Vector DB**: use provider snapshot/export. Save snapshots to S3 with checksums. For Milvus, snapshot and export index files. For Pinecone, export embeddings to S3 or database.
- **Audit & artifacts**: write daily compressed archives of audit topic to S3; preserve for legal retention.
- **Replay**: ensure a documented process to replay audit events and re-ingest vectors to rebuild vector DB if needed.

---

## # 8) Retention, TTL & legal-hold
- **Default TTL**: configurable (e.g., 365 days) for non-audit memory nodes. Implement soft-delete by default.
- **Legal hold**: items under legal hold are excluded from TTL deletion; mark with `legalHold: true`.
- **PII controls**: set `piiFlags` on nodes; enforce access restrictions (SentinelNet and Memory API checks) and redact on reads when required.

---

## # 9) Observability & SLOs
- **Metrics**: ingestion rate, vector write latency, search latency (p95), queue depth, worker errors, storage utilization.
- **Tracing**: propagate traces through API → queue → worker → Vector DB → Postgres.
- **Logs**: structured logs (traceId, memoryNodeId, caller). Ship to central logging.
- **SLO examples**: search p95 < 200ms, ingestion end-to-end median < X seconds (define based on model), vector write 95th < Y ms.
- **Alerts**: queue backlog, worker failure rate, Postgres replication lag, Vector DB health, S3 errors.

---

## # 10) Testing & validation
- **Integration tests**: ingest sample documents, ensure vectors written and semantic search returns expected hits.
- **Chaos tests**: simulate Vector DB unavailability and verify backpressure and DLQ behavior.
- **Restore drills**: regularly restore from Postgres backup and vector snapshot to ensure recoverability.
- **Perf tests**: load test embedding pipeline and search to validate SLOs and autoscaling thresholds.

---

## # 11) Scaling & capacity planning
- **Horizontal scale**: autoscale API and workers by CPU/queue depth. Vector DB scaling depends on provider (automatic in Pinecone; manual shards with Milvus).
- **Sharding**: partition vectors by namespace/tenant for multi-tenancy. Use logical shards to isolate heavy workloads.
- **Storage**: plan S3 capacity and lifecycle rules for artifacts and archived snapshots.

---

## # 12) CI/CD & migrations
- **Pipelines**: lint, unit tests, build container, integration tests in ephemeral env, push image, deploy to staging, run acceptance tests, then promote to prod (GitOps/ArgoCD recommended).
- **DB migrations**: run migrations as pre-deploy job. Use backward-compatible migrations where possible. Document breaking changes.
- **Vector DB upgrades**: test upgrade path on staging; snapshot before any upgrade.

---

## # 13) Access & audit
- **Audit events**: every create/update/delete must emit Kernel audit event (link to manifestSignatureId).
- **Access logs**: record who accessed what artifacts/memory nodes and include in audit exports for compliance.
- **Proof exports**: support canonical export that includes Postgres records, vector metadata, artifact checksums, and head hash.

---

## # 14) Acceptance criteria (deployment)
- Memory API deployed and healthy in staging with Postgres + Vector DB + S3 connected.
- Embedding pipeline ingests sample docs and semantic search returns expected results.
- Backups for Postgres and vector snapshots exist and a restore drill succeeds.
- RBAC, mTLS, and Vault secrets injection are working.
- Audit events emitted for all writes and archived to S3.
- Tracing, metrics, and alerts present for core signals.

---

## # 15) Operational runbooks (must exist)
- Vector DB degraded or full runbook.
- Postgres failover & restore runbook.
- DLQ management and embedding retry runbook.
- Legal-hold and TTL disputes runbook.
- Incident response for key compromise affecting artifact encryption.

---

End of file.

