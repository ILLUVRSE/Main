# Kernel — API Examples (Plain English + payloads)

Purpose: a handful of concise, readable request/response examples that show how the Kernel API is used for the most common flows. These are **examples**, not exact SDK code. Use them as references when implementing clients.

---

## # 1) Create / Update a DivisionManifest
**Intent:** register a division or update its manifest.

**Endpoint:** `POST /kernel/division`
**Request payload (JSON):**
```json
{
  "id": "dvg-1a2b-3c4d",
  "name": "Product",
  "goals": ["ship core product", "grow to 10k users"],
  "budget": 100000,
  "currency": "USD",
  "kpis": ["activationRate", "retention30"],
  "policies": ["policy-budget-cap-v1"],
  "metadata": {"owner": "ryan"},
  "status": "active",
  "version": "1.0.0"
}
Expected response (JSON):
{
  "id": "dvg-1a2b-3c4d",
  "audit_id": "audit-0023",
  "status": "ok"
}

Notes: Kernel should canonicalize and sign the manifest, write a ManifestSignature, and emit an audit event. If the manifest is invalid or the caller lacks RBAC permission, Kernel returns 403 or 400 with a short error.

2) Spawn an Agent from a Template

Intent: create a runtime agent instance tied to a division.

Endpoint: POST /kernel/agent
Request payload (JSON):
{
  "role": "GrowthHacker",
  "skills": ["outreach", "ads"],
  "code_ref": "git@github.com:ILLUVRSE/agents.git#growth-v1",
  "divisionId": "dvg-1a2b-3c4d",
  "templateId": "growth-v1"
}

Expected response (201 Created):
{
  "id": "agent-abc123",
  "role": "GrowthHacker",
  "state": "stopped",
  "created_at": "2025-01-12T08:00:00Z"
}

Notes: Agent Manager will later start the agent. Kernel should verify the DivisionManifest exists and that the caller has permission to spawn agents in that division. Kernel emits agent.spawn audit event after creation. If policy blocks spawn (SentinelNet), return 403 with policy details.

3) Retrieve Agent State & Recent Evals

Intent: fetch agent runtime snapshot and recent evaluation reports.

Endpoint: GET /kernel/agent/{id}/state
Sample response (200):

{
  "agent": {
    "id": "agent-abc123",
    "role": "GrowthHacker",
    "state": "running",
    "score": 0.83,
    "lastHeartbeat": "2025-01-12T09:58:00Z"
  },
  "evals": [
    {
      "id": "eval-001",
      "agentId": "agent-abc123",
      "metricSet": {"taskSuccess": 0.9, "latencyMs": 110},
      "timestamp": "2025-01-12T09:00:00Z"
    }
  ]
}

Notes: This endpoint is read-only but RBAC-protected. The Kernel may apply simple aggregation on evals when returning a snapshot.

4) Submit an EvalReport

Intent: reporting agent performance metrics to the Eval Engine via Kernel.

Endpoint: POST /kernel/eval
Request payload:

{
  "agent_id": "agent-abc123",
  "metric_set": {"taskSuccess": 0.9, "latencyMs": 110},
  "timestamp": "2025-01-12T09:00:00Z",
  "source": "sim-runner"
}

Response (200):
{
  "ok": true,
  "eval_id": "eval-001"
}

Notes: Kernel stores the eval, optionally computes a cached computedScore, and emits an eval.submitted audit event. Eval Engine consumes events or queries the DB for scoring.

5) Request Resource Allocation

Intent: request extra compute or capital for an entity.

Endpoint: POST /kernel/allocate
Request payload:
{
  "entity_id": "agent-abc123",
  "pool": "gpus-us-east",
  "delta": 1,
  "reason": "promote after high eval score"
}
Response (200):
{
  "ok": true,
  "allocation": {
    "id": "alloc-0001",
    "entityId": "agent-abc123",
    "pool": "gpus-us-east",
    "delta": 1,
    "status": "pending",
    "ts": "2025-01-12T10:00:00Z"
  }
}

Notes: Kernel records the allocation request and routes to Resource Allocator. SentinelNet must check policy (budget caps, pool quota). If SentinelNet rejects, Kernel returns 403 with policyId and reason.

6) Sign a Manifest

Intent: request Kernel to sign a manifest; Kernel returns a ManifestSignature record.

Endpoint: POST /kernel/sign
Request payload:

{
  "manifest": {
    "id": "dvg-1a2b-3c4d",
    "version": "1.0.0",
    "changes": {"budget": "+10000"}
  }
}

Response (200):
{
  "audit_id": "audit-0023",
  "signature_record": {
    "manifest_id": "dvg-1a2b-3c4d",
    "signer_id": "kernel-signer-1",
    "algorithm": "ed25519",
    "key_version": "kernel-signer-v1",
    "signature": "BASE64_SIG",
    "version": "1.0.0",
    "ts": "2025-01-12T10:05:00Z"
  }
}

Notes: The signature record is stored (with signer id, algorithm, and key_version for rotation audits) and an AuditEvent emitted linking the manifest and its signature. Kernel validates caller RBAC for signing privileges.

7) Fetch an Audit Event

Intent: retrieve an audit event for verification.

Endpoint: GET /kernel/audit/{id}
Response (200):
{
  "id": "audit-0023",
  "eventType": "manifest.update",
  "payload": { "manifestId": "dvg-1a2b-3c4d", "version": "1.0.0" },
  "prevHash": "0000...0",
  "hash": "e3b0c4...",
  "signature": "BASE64_SIG",
  "signerId": "kernel-signer-1",
  "ts": "2025-01-12T10:05:00Z"
}

Notes: Clients can re-compute hash and verify the signature against the Kernel public key. Include the canonicalization algorithm in your verification tool.

8) Retrieve a Reasoning Trace

Intent: fetch a causal/decision trace for inspection.

Endpoint: GET /kernel/reason/{node}
Response (200):
{
  "node": "reason-node-123",
  "trace": [
    {"step":1,"action":"ingest","note":"ingested metrics"},
    {"step":2,"action":"compute_score","note":"score=0.82"},
    {"step":3,"action":"recommend_promotion","note":"roi_positive"}
  ],
  "version": "v1"
}

Notes: Traces should be queryable, and sensitive PII must be redacted before display according to SentinelNet policies.

Error patterns & status codes (short)

400 — bad request / schema validation error.

401 — unauthenticated.

403 — RBAC denied or SentinelNet policy rejection (response should include policyId + short reason).

404 — resource not found.

409 — conflict (e.g., version mismatch on manifest updates).

500 — server error; responses include an error_id to find the audit/log entry.

Best practices (short)

Canonicalize JSON before hashing/signing; keep rules consistent across clients.

Use idempotency keys for mutation endpoints to avoid duplicate events.

Always check returned audit_id for important state changes — it’s the cryptographic handle for verification.

Keep client clocks synchronized (NTP) to avoid timestamp confusion in signatures and audits.
End of file.
