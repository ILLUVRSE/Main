# Memory Layer — Specification

## # Purpose
The Memory Layer is the authoritative persistent store for structured state, semantic vectors (embeddings), and large artifacts (models, logs, documents). It provides durable, queryable memory for agents and system components and a clear separation of responsibilities:
- Postgres for relational authoritative state and metadata.
- Vector DB (Milvus/Pinecone/Weaviate) for embeddings and semantic search.
- S3-compatible object storage for large artifacts, model binaries, and audit archives.

---

## # Core responsibilities
- Persist Division/Agent/Manifest metadata (Postgres).
- Store semantic embeddings in a vector store, referenced by `memory_node.id` or `embeddingId`.
- Host artifacts (model weights, logs, files) in object storage with provenance metadata.
- Provide stable, auditable joins between vector entries and relational metadata.
- Support CRUD and search APIs (exact and semantic).
- Enforce retention, TTL, and legal-hold policies for PII & audit data.
- Provide backup, restore, and replay capabilities for audits and verifications.
- Ensure RBAC, encryption-at-rest, and encryption-in-transit for all stores.

---

## # Minimal public interfaces (intents)
These are the functional APIs (Kernel/Agent/Infra call these; implement as service endpoints or DB access patterns):

- `createMemoryNode(payload)` — create a MemoryNode record (metadata, optional small text). Returns `id` and `embeddingId` placeholder.
- `getMemoryNode(id)` — fetch metadata and pointers to embedding/artifact.
- `storeEmbedding(embeddingId, vector, metadata)` — write vector to Vector DB.
- `searchEmbedding(queryEmbedding, topK, filter)` — semantic search returning `memoryNodeId`s + scores.
- `putArtifact(path, stream, metadata)` — store artifact in S3 and return signed URL + artifact id.
- `getArtifact(artifactId)` — fetch metadata and signed URL for artifact download.
- `listMemoryNodes(filter, cursor)` — list nodes by filters (owner, tags, type, date).
- `deleteMemoryNode(id)` — soft-delete (mark deleted) or apply TTL policy; physical deletion follows retention rules.
- `exportAuditRange(startTs, endTs)` — produce canonicalized export for auditors (joins audit events, manifests, and relevant memory nodes).

**Notes:** Authentication via Kernel (mTLS) or service tokens. All writes that affect manifests or provenance must produce corresponding audit events.

---

## # Canonical models (short)

## # MemoryNode (Postgres record)
- `id` — uuid.
- `text` — optional small text blob.
- `embeddingId` — string (id used in Vector DB).
- `metadata` — jsonb (source, tags, owner, references, piiFlags).
- `createdAt`, `updatedAt`, `ttl` (optional).
- `provenance` — pointer to manifestSignatureId or artifact id.
- `deleted` — boolean (soft delete marker).

## # VectorEntry (Vector DB)
- `embeddingId` — match MemoryNode.embeddingId.
- `vector` — numeric vector.
- `metadata` — object (memoryNodeId, scoreHints, createdAt).
- `namespace` / `index` — logical grouping (e.g., `kernel-memory`, `agent-<id>`).

## # Artifact record (S3 metadata)
- `artifactId` — uuid.
- `path` — s3 key.
- `size`, `contentType`.
- `checksum` — sha256.
- `owner`, `createdAt`, `manifestSignatureId`, `tags`.

---

## # Storage & join pattern
- Postgres holds authoritative indexes and metadata. Vector DB holds raw vectors and minimal metadata linking back to Postgres `memory_node.id`. Artifacts live in S3 with `artifactId` referenced in Postgres.
- Searches produce a list of `memory_node.id`s; callers then retrieve full metadata from Postgres and artifacts via S3 signed URLs.
- For performance, maintain a materialized view (or cache) that joins vector hits with the most-used metadata fields (title, owner, createdAt, snippet).

---

## # Embedding pipeline
- **Ingest path:** raw text/document → pre-processing (normalize, language detection, tokenize) → embedding model call → store vector in Vector DB, store metadata in Postgres.
- **Batching & dedup:** batch small documents/paragraphs; deduplicate by checksum to avoid duplicate vectors.
- **Versioning:** record the embedding model/version used in metadata for reproducibility.
- **Re-embedding:** support re-embedding jobs when models update; keep old vectors unless policy says otherwise and record re-embedding audit events.

---

## # Search semantics & filters
- Semantic search returns topK by similarity score. Support filters on metadata (owner, tags, date range, piiFlags).
- Combine semantic and exact (SQL) filters to restrict results before scoring when possible.
- Support hybrid scores: weighted combination of semantic similarity and recency/importance signals.

---

## # Retention, TTL & legal hold
- **Default TTL:** configurable (e.g., 365 days) for non-audit memory.
- **Audit & legal hold:** audit-related nodes and artifacts are immutable and excluded from TTL deletion. Legal-hold marks items for indefinite retention until release.
- **Soft delete:** mark `deleted=true`; physical deletion happens after retention window and after verifying no legal hold.

---

## # Backups, DR & replay
- **Postgres:** standard backups + WAL archiving for point-in-time recovery.
- **Vector DB:** snapshot/export strategy (provider-specific). Store vector exports in S3 with checksums.
- **Artifact store:** versioning + immutable object lock for audit buckets.
- **Replay:** ability to replay a time range of writes into a fresh Postgres + Vector DB to rebuild indexes and verify integrity.

---

## # Security & governance
- **Encryption:** TLS everywhere; encryption-at-rest for Postgres, Vector DB, and S3.
- **RBAC:** Kernel enforces RBAC for who can create/read nodes; cross-check in service layer.
- **PII handling:** mark `piiFlags` and restrict access; SentinelNet policies must be able to block or redact PII from reads.
- **Key management:** KMS for envelope encryption keys for artifacts and for any token/signing needs.
- **Auditing:** all create/update/delete operations must emit audit events with manifestSignatureId, caller, and provenance.

---

## # Performance & scale
- **Shard vector data** by namespace or logical shard when dataset large.
- **Caching:** cache frequent joins and small metadata in Redis for low-latency reads.
- **Throughput:** design ingestion pipeline with batching and parallel writers to Vector DB; apply backpressure when vector DB lags.
- **Monitoring:** track vector DB latency, Postgres slow queries, S3 throughput, and embedding queue length.

---

## # Implementation notes (provider choices)
- **Vector DB:** Pinecone or Milvus for scale; use whichever supports snapshots and multi-tenancy.
- **Postgres:** managed RDS/CloudSQL with `jsonb` for flexible metadata. Use partitioning for large `memory_nodes` table by date or owner.
- **S3:** AWS S3 or MinIO for on-prem; enable versioning and object lock for audit buckets.
- **Embedding models:** start with managed embedding APIs (or local model) and record model + version used; later consider hosting custom models.

---

## # Acceptance criteria (minimal)
- Postgres schema exists for `memory_nodes`, `artifact` with required fields and indexes.
- Vector DB integration: can store and retrieve vectors and return topK for a test embedding.
- Embedding pipeline: ingest a sample document, persist MemoryNode and vector, and retrieve via semantic search.
- Retention: TTL deletion respects legal hold; soft-delete works.
- Security: PII flag prevents retrieval when caller lacks permission; TLS and encryption enabled.
- Backup & recovery: Postgres WAL + vector snapshots can restore test dataset.
- Audit: All writes produce audit events with manifestSignatureId and caller info.

---

## # Example flow (short)
1. Agent stores a document via `createMemoryNode`. Kernel records manifest signature and emits audit.
2. Memory Layer preprocesses, computes embedding, stores vector in Vector DB with `embeddingId`, and stores metadata in Postgres linking to `embeddingId`.
3. Another agent runs `searchEmbedding` with query embedding → returns memoryNodeIds → app fetches metadata and artifact signed URLs from Postgres/S3.

---

End of file.

