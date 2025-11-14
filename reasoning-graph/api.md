# Reasoning Graph — API Reference

Purpose: precise, implementation-ready contract for the minimal Reasoning Graph service delivered in this repo. This document is the source of truth for request/response schemas, auth expectations, and error behavior.

---

## # Base URL, auth & headers
- **Base URL (default):** `http://localhost:8047` (configurable via `REASONING_GRAPH_ADDR`).
- **Auth:** all **write** endpoints require the Kernel mTLS client certificate. In local/dev we allow bearer tokens via `X-Debug-Token` (configurable); production **must** use mTLS.
- **Content type:** JSON (`application/json`). Requests without `Content-Type: application/json` are rejected with `415`.
- **Idempotency:** callers should provide `Idempotency-Key` header for node/edge creation when retrying (not enforced yet, but reserved).
- **Errors:** JSON body `{ "error": "message", "code": "REASONING_GRAPH_<CODE>" }` with appropriate HTTP status. Unknown errors return `500`.

---

## # Models

```jsonc
ReasonNode {
  "id": "uuid",
  "type": "observation|recommendation|decision|action|hypothesis|policyCheck|score",
  "payload": { /* arbitrary JSON */ },
  "author": "agent/kernel component id",
  "version": "semantic or snapshot ref",
  "manifestSignatureId": "optional manifest signature",
  "auditEventId": "optional audit linkage",
  "metadata": { "confidence": 0.93, "tags": ["foo"] },
  "createdAt": "RFC3339 timestamp"
}

ReasonEdge {
  "id": "uuid",
  "from": "ReasonNode.id",
  "to": "ReasonNode.id",
  "type": "causal|supports|contradicts|derivedFrom|influencedBy",
  "weight": 0.42,
  "metadata": { "note": "optional" },
  "createdAt": "RFC3339 timestamp"
}

ReasonSnapshot {
  "id": "uuid",
  "rootNodeIds": ["uuid", "..."],
  "hash": "hex-encoded SHA256",
  "signature": "base64 signature",
  "signerId": "kms or signer id",
  "description": "string",
  "snapshot": { "nodes": [...], "edges": [...] },
  "createdAt": "RFC3339 timestamp"
}
```

---

## # Endpoints

### 1. `POST /reason/node`

Creates a new node.

**Request**
```json
{
  "type": "decision",
  "payload": { "action": "allocate GPUs", "rationale": "score>0.8" },
  "author": "kernel-resource-allocator",
  "version": "rg-v1",
  "manifestSignatureId": "manifest_123",
  "metadata": { "confidence": 0.91, "tags": ["gpu", "promotion"] }
}
```

Fields:
- `type` (required) — must be one of the model enum values.
- `payload` (required) — JSON object, canonicalized internally.
- `author` (required).
- `version`, `manifestSignatureId`, `auditEventId`, `metadata` optional.

**Response `201`**
```json
{
  "nodeId": "c9a7b0b0-6bf5-4dd7-aaee-0a2cf0a7ad83",
  "createdAt": "2025-01-17T18:43:05Z"
}
```

Errors:
- `400` invalid body.
- `401/403` missing or invalid auth.
- `409` idem key conflict (reserved).

---

### 2. `POST /reason/edge`

Creates a directed edge between two nodes.

**Request**
```json
{
  "from": "c9a7b0b0-6bf5-4dd7-aaee-0a2cf0a7ad83",
  "to": "9f6b54a9-7d0c-4a2b-8081-ecb158c8d72c",
  "type": "causal",
  "weight": 0.8,
  "metadata": { "explanation": "recommendation led to decision" }
}
```

**Response `201`**
```json
{
  "edgeId": "21f8009f-6e97-43cb-8bdb-ae8b4c318c9c",
  "createdAt": "2025-01-17T18:45:02Z"
}
```

Errors:
- `400` invalid payload.
- `404` `from` or `to` node missing.

---

### 3. `GET /reason/node/{id}`

Returns a node and its adjacent edges.

**Response `200`**
```json
{
  "node": { /* ReasonNode */ },
  "incoming": [ /* ReasonEdge[] where to == id */ ],
  "outgoing": [ /* ReasonEdge[] where from == id */ ]
}
```

Errors: `404` when node missing.

---

### 4. `GET /reason/trace/{id}?direction=ancestors|descendants&depth=3`

Computes a trace graph starting from `id`.

Parameters:
- `direction` default `ancestors`.
- `depth` default `3`, max `10`.

**Response `200`**
```json
{
  "startNodeId": "c9a7b0b0-6bf5-4dd7-aaee-0a2cf0a7ad83",
  "direction": "ancestors",
  "depth": 3,
  "steps": [
    {
      "id": "c9a7b0b0-6bf5-4dd7-aaee-0a2cf0a7ad83",
      "node": { "type": "decision", ... },
      "incoming": [],
      "outgoing": [ "21f8009f-6e97-43cb-8bdb-ae8b4c318c9c" ],
      "cycleDetected": false
    },
    {
      "id": "9f6b54a9-7d0c-4a2b-8081-ecb158c8d72c",
      "node": { "type": "recommendation", ... },
      "incoming": [ "cycle-edge-id" ],
      "cycleDetected": true
    }
  ],
  "edges": [
    { "id": "21f8009f-6e97-43cb-8bdb-ae8b4c318c9c", "from": "...", "to": "...", "type": "causal" }
  ]
}
```

The service annotates `cycleDetected` when traversal encounters an already-visited node.

Errors: `404` missing node, `400` for invalid parameters.

---

### 5. `POST /reason/snapshot`

Creates a signed snapshot rooted at specified nodes.

**Request**
```json
{
  "rootNodeIds": [
    "c9a7b0b0-6bf5-4dd7-aaee-0a2cf0a7ad83"
  ],
  "description": "Promotion decision trace (2025-01-17)"
}
```

Process:
1. Service fetches each root node and neighbouring nodes (depth configurable via `SNAPSHOT_DEFAULT_DEPTH`, default `2`).
2. Builds canonical JSON: `{"nodes":[...sorted by id...],"edges":[...sorted...]}`.
3. Computes SHA-256 hex digest.
4. Signs digest using Ed25519 private key supplied via `REASONING_GRAPH_SNAPSHOT_KEY` (base64). The signer ID is configured via `REASONING_GRAPH_SIGNER_ID`.
5. Persists record and returns metadata.

**Response `201`**
```json
{
  "snapshotId": "2f1a49f2-0437-49d5-8075-0ae4cdfeb3a2",
  "hash": "b0f6e5...",
  "signature": "ZHVtbXk=",
  "signerId": "kernel-dev-signer",
  "createdAt": "2025-01-17T18:50:31Z"
}
```

Errors:
- `400` when roots missing.
- `404` when any root node missing.
- `500` if signing fails.

---

### 6. `GET /reason/snapshot/{id}`

Returns stored snapshot metadata and canonical JSON.

**Response `200`**
```json
{
  "snapshot": {
    "id": "2f1a49f2-0437-49d5-8075-0ae4cdfeb3a2",
    "rootNodeIds": ["..."],
    "hash": "b0f6e5...",
    "signature": "ZHVtbXk=",
    "signerId": "kernel-dev-signer",
    "description": "Promotion decision trace (2025-01-17)",
    "snapshot": { "nodes": [...], "edges": [...] },
    "createdAt": "2025-01-17T18:50:31Z"
  }
}
```

Optional `?format=canonical|human` query parameter:
- `canonical` (default) returns canonical JSON for verification.
- `human` returns snapshot with rendered steps + metadata.

Errors: `404` unknown snapshot.

---

### 7. `GET /health`

Simple readiness endpoint. Returns `200 {"ok":true,"db":"up","time":"..."}` when DB reachable.

---

## # Error codes
- `REASONING_GRAPH_BAD_REQUEST`
- `REASONING_GRAPH_NOT_FOUND`
- `REASONING_GRAPH_AUTH`
- `REASONING_GRAPH_INTERNAL`
- `REASONING_GRAPH_DEPENDENCY` (snapshots/signing failures)

---

## # Pagination & limits
- Trace depth limited to `10`.
- Snapshot root list limited to 32 nodes per request.
- Payload size limited to 256KB per node by default (configurable via `MAX_NODE_PAYLOAD_BYTES`).

---

## # Example flow (happy path)
1. Eval Engine posts `score` node → service returns node id.
2. Eval Engine posts `recommendation` node + `causal` edge linking to score.
3. Kernel posts `decision` node + `supports` edge.
4. ControlPanel requests `GET /reason/trace/{decisionId}` to display provenance.
5. Kernel calls `POST /reason/snapshot` with the decision as root, receives signed hash for audit.

---

End of file.
