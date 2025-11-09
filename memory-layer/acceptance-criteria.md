# Memory Layer — Acceptance Criteria

This checklist ensures Memory Layer correctness for persistence, embeddings, search, audit, and governance.

## # 1) Schema & storage
- Postgres schema (`memory_nodes`, `artifact`, indexes) created and migration tested.
- Vector DB index created and accessible.

## # 2) Embedding pipeline
- Ingest a document → Postgres `memory_node` and vector inserted with same `embeddingId`.
- Embedding metadata records model and version.
- Re-ingestion idempotent when content checksum identical.

## # 3) Semantic search
- Top-K returns deterministic ordering for test vectors, with metadata filters respected.
- Hybrid scoring returns predictable ordering.

## # 4) Provenance & artifacts
- Artifact uploads record checksum, manifestSignatureId, and owner in Postgres.
- Audit event links artifact+manifest and passes chain verification.

## # 5) TTL & legal-hold
- TTL deletion soft-deletes per policy; legal-hold items preserved.

## # 6) Security & PII
- PII flagged items blocked for unauthorized reads or redacted.

## # 7) Backup & restore
- Restore drill recovers Postgres + Vector DB and makes sample nodes searchable.

## # Test harness
- Provide integration tests for ingest→vector→search, backup/restore and audit verification.

