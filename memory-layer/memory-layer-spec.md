# Memory Layer — Specification

## Purpose
Canonical persistent store for MemoryNodes, embeddings, artifact metadata, and provenance.

## Security
- TLS everywhere; RBAC enforced; audit events emitted for writes.

## Data models (high level)
### `memory_node`
- `id`, `embeddingId`, `owner`, `metadata`, `created_at`, `legalHold`, `piiFlags`.

### `artifact`
- `id`, `artifact_url`, `sha256`, `manifestSignatureId`, `created_by`, `size_bytes`, `created_at`.

### `audit_event`
- `id`, `type`, `payload`, `ts`, `prevHash`, `hash`, `signature`.

## API
### `POST /memory/nodes`
- Body: `{ embeddingId, metadata, vectors? }`
- Behavior: Persist node, push vector write job, emit audit event.

### `POST /memory/artifacts`
- Body: `{ artifact_url, sha256, metadata, manifestSignatureId }`
- Behavior: Validate checksum (optional), persist artifact record, emit audit.

### `POST /memory/search`
- Body: `{ query_embedding, top_k, filters }`
- Behavior: Query Vector DB and return ordered `memory_node` ids + scores.

### `GET /memory/node/{id}`
- Returns memory node and artifact references.

## Audit & provenance
- Every write emits an audit event with `manifestSignatureId` when applicable.
- Audit events must be canonicalized and signed.

## Retention & legal hold
- TTL job runs regularly; soft-delete semantics; legal hold prevents deletion.

