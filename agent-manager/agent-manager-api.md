# Agent Manager — API Reference (Plain English)

## Purpose
This document lists the Agent Manager’s external API endpoints (the Kernel calls these). It describes each endpoint’s intent, required authentication, key fields in the request, and the minimal expected response. Keep implementations strictly compatible with these shapes.

**Auth:** Kernel ↔ Agent Manager calls use mTLS + Kernel service identity. Human/CLI calls (if allowed) require Kernel-issued short-lived delegation tokens. All mutating calls must be authorized by Kernel (RBAC checked in Kernel).

**Idempotency:** Mutating endpoints accept an `Idempotency-Key` header; duplicate requests with same key must not create duplicate resources.

---

## 1) Register an AgentTemplate
**Endpoint:** `POST /agent-manager/templates`  
**Intent:** Register a new versioned AgentTemplate (must be signed by Kernel or an approved signer).  
**Auth:** mTLS (Kernel service identity)  
**Required payload (JSON):**
- `id` (optional, server-generated if absent)  
- `name`  
- `description` (optional)  
- `codeRef` (git url / image uri / artifact pointer)  
- `manifest` (template config json)  
- `resourceLimits` ({ cpu, memoryMB, gpuCount, diskMB })  
- `env` (map)  
- `signerId` and `signature` (kernel manifest signature)  
- `version`  
- `createdBy`  
**Minimal response (201 Created):**
```json
{
  "id": "template-123",
  "name": "growth-v1",
  "version": "1.0.0",
  "createdAt": "2025-01-12T10:00:00Z"
}

Errors: 400 validation, 401 auth, 403 if signature invalid or caller unauthorized, 409 if version conflict.

2) Fetch an AgentTemplate

Endpoint: GET /agent-manager/templates/{id}
Intent: Return template manifest, signature, and metadata.
Auth: mTLS or Kernel delegations.
Response (200):

{
  "id":"template-123",
  "name":"growth-v1",
  "manifest": { /* template json */ },
  "codeRef":"git@github.com:...#growth-v1",
  "resourceLimits": {"cpu":1,"memoryMB":2048,"gpuCount":0},
  "signerId":"kernel-signer-1",
  "signature":"BASE64_SIG",
  "version":"1.0.0",
  "createdAt":"2025-01-12T10:00:00Z"
}

3) Instantiate an AgentInstance

Endpoint: POST /agent-manager/instantiate
Intent: Create an AgentInstance from a template for a division. This begins the provisioning lifecycle (provisioning → provisioned → starting → running).
Auth: mTLS; Kernel must verify Division and RBAC before calling.
Required payload (JSON):

templateId

divisionId

role (string)

overrides (optional runtime overrides: env, resourceLimits)

requestedBy (actor id)

idempotencyKey (client-supplied optional)
Behavior:

Verify template signature against Kernel Key Registry.

Request allocation from Resource Allocator via Kernel.

Call SentinelNet to validate policy.

If approved, provision resources, fetch image, inject secrets, start runtime.

Emit agent.instantiated and lifecycle audit events.
Response (202 Accepted):

{
  "agentId":"agent-xyz789",
  "status":"provisioning",
  "requestedAt":"2025-01-12T10:05:00Z"
}

Errors: 400 validation; 403 policy block; 409 duplicate idempotent request; 500 provisioning failure (with error_id).

4) Get Agent State

Endpoint: GET /agent-manager/agent/{id}/state
Intent: Return authoritative runtime state, last heartbeat, resource allocation, health, provenance, and recent events.
Auth: mTLS or Kernel delegation.
Response (200):

{
  "id":"agent-xyz789",
  "templateId":"template-123",
  "role":"GrowthHacker",
  "state":"running",
  "resourceAllocation":{"cpu":2,"gpu":1,"memoryMB":8192},
  "host":"node-12.pod.cluster",
  "lastHeartbeat":"2025-01-12T10:20:00Z",
  "health":{"liveness":"ok","readiness":"ok"},
  "provenance":{"codeRef":"git@...#commit-sha","imageDigest":"sha256:..."},
  "recentEvents":[{"type":"started","ts":"2025-01-12T10:10:00Z"}]
}

5) List Agents

Endpoint: GET /agent-manager/agents
Intent: List agents with optional filters: divisionId, state, templateId, owner, pagination params.
Auth: mTLS / Kernel.
Response (200):

{
  "items":[ /* array of AgentInstance summaries */ ],
  "cursor":"next-cursor"
}

6) Agent lifecycle action

Endpoint: POST /agent-manager/agent/{id}/action
Intent: Request a lifecycle action for an agent: start, stop, pause, resume, restart, destroy.
Auth: mTLS; Kernel must authorize action according to RBAC and policy.
Payload (JSON):

action (string)

requestedBy (actor id)

reason (optional)
Behavior: Agent Manager validates state transitions, enforces preconditions, emits agent.action.requested, and returns status. Actions must be idempotent and recorded as AgentActionRecord.
Response (200):

{
  "agentId":"agent-xyz789",
  "action":"restart",
  "status":"accepted",
  "ts":"2025-01-12T11:00:00Z"
}

Errors: 400, 403 (policy), 409 (invalid state transition).

7) Heartbeat (agent → manager)

Endpoint: POST /agent-manager/agent/{id}/heartbeat
Intent: Agents call this (or manager records it) to mark liveness and provide lightweight metrics.
Auth: mTLS using agent identity (or manager-managed).
Payload:

ts (timestamp)

uptimeSeconds (optional)

metrics (optional small summary)
Response: 200 with updated lastHeartbeat. Missing heartbeats trigger failed state after configured threshold.

8) Logs & metrics ingestion (or pointers)

Endpoint (ingest): POST /agent-manager/agent/{id}/logs
Intent: Ingest logs or store a pointer (preferred) to centralized log store.
Payload: either raw logs (batched) or logsUrl (S3/ELK pointer) and tailToken.
Endpoint (metrics): POST /agent-manager/agent/{id}/metrics — ingest summarized metrics or expose scrape endpoint.
Auth: mTLS.
Response: 200 / 202 for async ingestion.

9) Fetch provenance / artifacts

Endpoint: GET /agent-manager/agent/{id}/provenance
Intent: Return authoritative provenance: codeRef, image digest, node, secrets snapshot references (not secrets), and final config. Useful for audits.
Auth: Kernel / Auditor roles.
Response (200):

{
  "agentId":"agent-xyz789",
  "codeRef":"git@...#commit-sha",
  "imageDigest":"sha256:...",
  "node":"node-12",
  "config": { /* runtime config */ },
  "secretsRef":"vault-path:agents/agent-xyz789/secret-meta"
}

10) Webhooks / Event callbacks

Mechanism: Agent Manager pushes lifecycle events to Kernel audit bus (preferred) or calls a Kernel webhook endpoint when necessary. Events include agent.instantiated, agent.started, agent.heartbeat, agent.failed, agent.destroyed.
Auth: mTLS; Kernel validates and persists events as audit events.

Error patterns & status codes (short)

400 — bad request / validation.

401 — unauthenticated (mTLS failed).

403 — forbidden (policy or RBAC block).

404 — not found.

409 — conflict or stale idempotency.

500 — internal error (include error_id for tracing).

Best practices & notes

Verify Template Signature: Always verify the Kernel-provided signature before instantiating a template. Reject if invalid.

Atomic provenance: Capture exact image digest and runtime config atomically at start to ensure auditability.

Secrets: Inject from Vault at runtime; do not persist secrets in DB or logs.

Rate limiting & retries: Provisioning can be slow; use async responses and polling. Use idempotency keys for safe retries.

Observability: Expose Prometheus metrics for provisioning latency, active agents, failed starts, and heartbeat gaps.

Policy checks: Call SentinelNet before provisioning and subscribe to runtime policy decisions for live enforcement.

End of API reference.
