# Reasoning Graph — API & Examples

This document defines the Reasoning Graph HTTP API: node/edge writes, trace queries, snapshot creation & verification, explain endpoints, annotations/corrections, and operational/admin endpoints. All endpoints return JSON and follow the `{ ok: boolean, ... }` envelope. Production requires Kernel-authenticated writes (mTLS or kernel-signed tokens), signed snapshots, and audit linkage. See `reasoning-graph/acceptance-criteria.md` for the final gates and tests. 

---

## Conventions

* **Base URL**: `https://reasoning-graph.example.com` (adjust per deployment).
* **Envelope**: Success: `{ "ok": true, ... }`. Error: `{ "ok": false, "error": { "code", "message", "details" } }`.
* **Auth & RBAC**:

  * **Writes** (`POST /nodes`, `POST /edges`, `POST /snapshots`) must come **only** from Kernel via mTLS or Kernel-signed bearer tokens. Calls from other principals are rejected (`401/403`). See acceptance criteria. 
  * **Reads** may be allowed to other services or principals per RBAC (e.g., Control-Panel, Eval Engine, SentinelNet) with Kernel-mediated roles (`read:trace`, `read:pii`).
* **Audit**: Every state-changing action must emit an AuditEvent linking to the Kernel-signed manifest or include `hash`, `prevHash`, and `signature` details. Use `kernel/tools/audit-verify.js` for chain verification in tests. 
* **Canonicalization**: Canonical snapshot bytes must match Kernel canonicalization rules (use parity vectors and parity tests for Node/Go parity). See `kernel/test/node_canonical_parity.test.js` for example approach. 

---

## Core types (JSON schema sketches)

### ReasonNode

```json
{
  "id": "uuid or string",
  "type": "Decision | Recommendation | Observation | Action | Correction",
  "actor": "actor:id",
  "ts": "2025-11-17T12:34:56Z",
  "payload": { /* domain payload, contain references to manifests, metrics */ },
  "metadata": { "confidence": 0.95, "source": "eval-engine" }
}
```

### ReasonEdge

```json
{
  "id": "uuid",
  "from": "node-id",
  "to": "node-id",
  "type": "causes|supports|annotates",
  "metadata": {}
}
```

### ReasonTrace

A `ReasonTrace` is an ordered/annotated causal path derived from nodes & edges; it is a view produced by queries or snapshots.

---

## Endpoints

> **Note:** Replace `{id}` placeholders with URL-encoded values. All `POST` changes must be Kernel-authenticated.

---

### Write APIs (Kernel-only)

#### `POST /nodes`

Create one or many ReasonNodes. **Kernel only.**

Body:

```json
{
  "nodes": [
    {
      "id": "node-123",
      "type": "Decision",
      "actor": "service:eval-engine",
      "ts": "2025-11-17T12:00:00Z",
      "payload": { "reason": "model improved", "score": 0.92 },
      "metadata": { "manifest_ref": "manifest-sig-abc" }
    }
  ],
  "audit_context": { "kernel_manifest_signature_id": "manifest-sig-abc" }
}
```

Response:

```json
{ "ok": true, "nodes": [{ "id": "node-123", "created_at": "2025-11-17T12:00:01Z" }] }
```

**Errors**

* `NOT_AUTHORIZED` — non-Kernel caller (401/403)
* `INVALID_PAYLOAD` — malformed node (400)

**How to verify**

* Unit tests that attempt unauthenticated writes must get `403`. Integration tests should post from Kernel mock and assert AuditEvent creation. See acceptance criteria for Kernel-authenticated writes. 

---

#### `POST /edges`

Create edges between nodes. **Kernel only.**

Body:

```json
{
  "edges": [
    { "id": "edge-1", "from": "node-1", "to": "node-2", "type": "causes", "metadata": {} }
  ],
  "audit_context": { "kernel_manifest_signature_id": "manifest-sig-abc" }
}
```

Response:

```json
{ "ok": true, "edges": [{ "id": "edge-1", "created_at": "..." }] }
```

---

#### `POST /snapshots`

Create a canonical signed snapshot of a trace or range. **Kernel-only or Kernel-authorized service calls.**

Body:

```json
{
  "snapshot_request_id": "snap-20251117-001",
  "root_node_id": "node-23",
  "range": { "from_ts": "...", "to_ts": "..." }, // optional alternative to root_node_id
  "audience": "auditor|operator", // auditor snapshots may include PII under policy
  "include_annotations": true
}
```

Response:

```json
{ "ok": true, "snapshot_id": "snapshot-20251117-001", "status": "signed|pending" }
```

**Snapshot signing**

* Snapshot generation includes:

  * Canonicalization of the snapshot payload (must follow Kernel canonicalizer parity).
  * Hash computation (sha256) and signature via KMS/signing-proxy.
  * Storage of snapshot metadata and `signer_kid` and signature.
* The response should include `snapshot_id`, `hash`, `signer_kid`, and `signature` when ready.

**How to verify**

* Snapshot parity tests and signature verification are mandatory in acceptance tests. See parity test example in Kernel. 

---

### Read APIs

#### `GET /node/{id}`

Return a single node with metadata and references to audit events.

Response:

```json
{
  "ok": true,
  "node": {
    "id": "node-123",
    "type": "Decision",
    "actor": "service:eval-engine",
    "ts": "...",
    "payload": { /* truncated or redacted per PII policy */ },
    "metadata": { ... },
    "audit_refs": [{ "audit_id": "av-1", "hash": "...", "signature": "..." }]
  }
}
```

**PII handling**

* Fields containing PII must be redacted for callers without `read:pii` capability per `PII_POLICY.md`. See PII policy doc for redaction levels. 

---

#### `GET /trace/{id}`

Return an ordered, annotated trace starting at `root node` or `trace id`. The API returns nodes and edges in an ordered causal path, plus annotations and confidence metadata.

Response:

```json
{
  "ok": true,
  "trace": {
    "id": "trace-123",
    "root": "node-1",
    "ordered_nodes": [ /* nodes with annotations */ ],
    "edges": [ /* edges */ ],
    "explain": "short human-readable rationale string"
  }
}
```

**Cycle handling**

* Cycle detection: the service should detect cycles and safely present a DAG-like view or truncated cycle indicator. See acceptance criteria for cycle-safety tests. 

---

#### `GET /snapshots/{id}`

Return snapshot metadata and signed proof. If requested and authorized, return the snapshot payload or a URL to the snapshot archive.

Response:

```json
{
  "ok": true,
  "snapshot": {
    "snapshot_id": "snapshot-20251117-001",
    "status": "signed",
    "hash": "...",
    "signer_kid": "...",
    "signature": "...",
    "ts": "...",
    "s3_path": "s3://reasoning-snapshots/prod/..."
  }
}
```

**Verification**

* Clients should verify signature using signer public key as published in Kernel registry.

---

#### `GET /node/{id}/explain` or `GET /trace/{id}/explain`

Return human-readable explanation and evidence references for a node or trace.

Response:

```json
{
  "ok": true,
  "explain": {
    "summary": "The model recommended promotion because score delta > 0.02 for 24h window.",
    "components": [
      { "name": "score_delta", "value": 0.024, "confidence": 0.9 },
      { "name": "coverage", "value": 0.98 }
    ],
    "evidence": [ { "audit_ref": "av-1", "note": "Telemetry aggregated window 24h" } ]
  }
}
```

---

### Annotations & Corrections

#### `POST /node/{id}/annotations`

Append an annotation or correction to a node (append-only). This operation must be auditable and produce an AuditEvent.

Body:

```json
{
  "author": "operator:alice@example.com",
  "text": "Correction: metric was computed with an outdated dataset.",
  "metadata": { "type": "correction" }
}
```

Response:

```json
{ "ok": true, "annotation_id": "ann-123", "created_at": "..." }
```

**Rules**

* Annotations are append-only. Corrections must not mutate historical node payloads; instead, create correction nodes or annotation nodes as per acceptance criteria.

---

### Admin & operator endpoints (server-side, restricted)

#### `GET /metrics`

Prometheus metrics.

#### `GET /health` / `GET /ready`

Health, transport & KMS/signing status.

#### `POST /admin/reindex`

Admin-only: trigger reindex or snapshot recompute for a specific range (requires multisig for production).

---

## Error codes (examples)

* `NOT_AUTHORIZED` — caller not Kernel for writes, or insufficient role for PII reads (401/403)
* `INVALID_PAYLOAD` — malformed node/edge (400)
* `CANONICALIZATION_ERROR` — snapshot canonicalizer failed (422)
* `SIGNING_FAILURE` — KMS/signing-proxy failed (500)
* `SNAPSHOT_NOT_READY` — snapshot is pending (202)
* `PII_REDACTED` — field redacted due to policy (200 with masked fields)

---

## Observability & SLOs

Expose these metrics:

* `reasoning_graph.trace_query_latency_seconds` (histogram)
* `reasoning_graph.snapshot_generation_seconds` (histogram)
* `reasoning_graph.snapshots_total` (counter)
* `reasoning_graph.canonicalization_failures_total` (counter)

SLOs:

* Trace query p95 < 200ms (dev) / production target < 50ms.
* Snapshot generation p95 < 5s for small traces; define sizing for large traces.

See `reasoning-graph/deployment.md` for runbook and SLO guidance. 

---

## Canonicalization & parity

* Snapshot canonicalization must match Kernel canonicalization rules. Provide parity vectors and a parity test (node_canonical_parity.test.*) to guarantee byte-for-byte parity across implementations (Node ↔ Go). See Kernel parity test for an example. 

---

## Example usage flows

### 1) Eval Engine creates decision nodes and asks for snapshot

1. Eval Engine calls Kernel to authorize the operation. Kernel calls `POST /nodes` on Reasoning Graph (mTLS + Kernel identity).
2. Eval Engine requests `POST /snapshots` for the `root_node_id`. Kernel-authorized request ensures audit linkage. Reasoning Graph builds the snapshot, signs it with KMS, stores the snapshot and returns `snapshot_id` + signature.
3. Control-Panel uses `GET /snapshots/{id}` to render signed snapshot metadata and fetch the snapshot payload if authorized.

### 2) Operator reviews trace & annotates

1. UI calls `GET /trace/{id}` (with `read:trace` capability) to fetch an explainable trace.
2. Operator adds annotation via `POST /node/{id}/annotations`. Reasoning Graph appends annotation and emits an AuditEvent (signed or Kernel-anchored).

---

## Tests & acceptance hooks (what must be tested)

Per `reasoning-graph/acceptance-criteria.md`:

* Kernel-authenticated writes only — unit/integration tests asserting 401/403 for non-kernel writes. 
* Trace ordering & cycle-safety — deterministic tests with synthetic traces.
* Snapshot canonicalization parity & signature verification — parity vectors and signature verification tests. 
* PII redaction tests — role-based fetch tests. See `PII_POLICY.md`. 
* Integration tests with Eval Engine, Agent Manager, SentinelNet, and Kernel mock. 

---

## Security notes (must be enforced)

* Reject any write requests not originating from Kernel (mTLS or Kernel-signed tokens). Kernel is the enforcement plane for RBAC and human mediation. 
* Sign snapshots via KMS or signing-proxy; do not embed private keys in the repo. Rotate keys per org policy and publish public keys to Kernel verifier registry before swapping. 

---

## Admin checklist for PRs / Sign-off

* [ ] API implemented as specified with contract tests.
* [ ] Kernel-authenticated write tests pass.
* [ ] Snapshot generation + signing implemented and verified against signer public key.
* [ ] Canonicalization parity test present and passing.
* [ ] PII redaction tests present and passing.
* [ ] Integration tests with Eval Engine / SentinelNet pass.
* [ ] Metrics & tracing present.
* [ ] Security sign-off on signing + PII policy complete.
* [ ] Final sign-off by **Ryan (SuperAdmin)**.

---
