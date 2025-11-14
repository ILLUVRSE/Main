# Memory Layer — API Reference

The Memory Layer exposes a minimal REST surface to ingest, retrieve, and search MemoryNodes, artifacts, and audit data. All endpoints are versioned under `/v1` and expect `Content-Type: application/json`.

## Common behavior
- **Auth:** mTLS + JWT (service-to-service). Caller id is propagated via `X-Service-Id`.
- **Idempotency:** supply `Idempotency-Key` header for POST operations; duplicates return `200` with original payload.
- **Audit headers:** `X-Manifest-Signature-Id`, `X-Prev-Audit-Hash` populate audit events when available.
- **Errors:** JSON envelope `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`.

## Endpoints

### POST `/v1/memory/nodes`
Create a MemoryNode and enqueue (or perform) a vector write.

Request:
```jsonc
{
  "embeddingId": "uuid",
  "owner": "kernel",
  "metadata": { "topic": "mission-brief", "pii": false },
  "legalHold": false,
  "ttlSeconds": 604800,
  "embedding": {
    "model": "text-embedding-3-large",
    "dimension": 1536,
    "vector": [0.01, -0.02, "..."]
  },
  "artifacts": [
    { "artifactUrl": "s3://.../foo.pdf", "sha256": "abc", "sizeBytes": 1234 }
  ]
}
```

Response `201`:
```json
{
  "memoryNodeId": "d6a6bdb1-08bb-4b0d-a877-35fa8b1af495",
  "embeddingJobId": "vect_123",
  "auditId": "aud_456"
}
```

Validations:
- `embedding.vector` required for synchronous writes; omit to defer to worker.
- `ttlSeconds` must be >= 3600; legal hold ignores TTL.
- Artifact checksums required if `artifacts` present.

### GET `/v1/memory/nodes/:id`
Fetch MemoryNode metadata, artifacts, and audit pointer.

Response `200`:
```json
{
  "memoryNodeId": "uuid",
  "owner": "kernel",
  "metadata": { "topic": "mission-brief" },
  "legalHold": false,
  "piiFlags": { "containsPii": true, "classification": ["contact"] },
  "artifacts": [
    { "artifactId": "art_1", "artifactUrl": "s3://...", "sha256": "abc" }
  ],
  "latestAudit": {
    "auditId": "aud_456",
    "hash": "0xabc",
    "timestamp": "2024-06-18T18:22:11Z"
  }
}
```

### POST `/v1/memory/artifacts`
Persist artifact metadata + checksum tied to an optional MemoryNode.

Body:
```json
{
  "artifactUrl": "s3://bucket/key",
  "sha256": "deadbeef",
  "sizeBytes": 1048576,
  "memoryNodeId": "uuid",
  "manifestSignatureId": "sig_789"
}
```
Returns `201 { "artifactId": "art_123" }`.

### GET `/v1/memory/artifacts/:id`
Returns artifact metadata, owners, manifest signature, and audit reference.

### POST `/v1/memory/search`
Hybrid semantic search over MemoryNodes.

Body:
```json
{
  "queryEmbedding": [0.1, 0.2, "..."],
  "topK": 10,
  "filter": {
    "owner": ["kernel", "agent-manager"],
    "metadata.topic": ["mission-brief"],
    "piiFlags.containsPii": false
  },
  "namespace": "kernel-memory",
  "scoreThreshold": 0.78
}
```

Response `200`:
```json
{
  "results": [
    {
      "memoryNodeId": "uuid",
      "score": 0.91,
      "metadata": { "topic": "mission-brief" },
      "artifactIds": ["art_1"],
      "vectorRef": "vect_123"
    }
  ]
}
```

### POST `/v1/memory/nodes/:id/legal-hold`
Sets or clears legal-hold.
```json
{ "legalHold": true, "reason": "litigation-123" }
```
Responds with `204`.

### DELETE `/v1/memory/nodes/:id`
Soft-delete node (sets `deleted_at`). Fails with `409` if legal hold active.

### Health endpoints
- `GET /healthz` → checks DB + vector adapter.
- `GET /readyz` → verifies migrations applied and adapter warmed.

## Pagination & filtering
- Retrieval endpoints that return collections (future `/memory/nodes`) accept `cursor` + `limit` (`<=100`).
- Filters map to Postgres JSONB path queries and must be whitelisted to prevent arbitrary SQL.

## Rate limits
- Default: 200 requests/min per service for write endpoints, 1000/min for search.
- Limits enforced by API gateway; `429` responses include `Retry-After`.

## Versioning & compatibility
- Breaking changes introduce `/v2`.
- Non-breaking fields should be marked optional and documented with default behavior.
