# Kernel — Canonical Data Models

This document lists the canonical models for the Kernel (minimal, precise, DB hints, required fields,
and examples). Keep these authoritative. Implementations must match these field names and types.
All timestamps are ISO 8601 strings unless otherwise noted.

---

## Conventions

* API shapes: `camelCase`.
* Postgres/DB types: use `snake_case` for table/column names.
* UUID = `uuid` / `text` with `CHECK` if not using native uuid.
* Timestamps = `timestamptz` (stored in UTC).
* Binary blobs: store in S3; DB stores pointers/paths and checksums.
* All *write* operations that affect provenance must emit an `AuditEvent` and include `manifestSignatureId` where applicable.
* Signatures: Ed25519 strings produced by KMS/HSM. Signer referenced by `signer_id` (string).

---

## 1) DivisionManifest

**Purpose:** Administrative bundle describing a division (goals, budget, policies).

**API shape**

```json
{
  "id":"uuid",
  "name":"string",
  "goals":["string"],
  "budget": 1234.56,
  "kpis":["string"],
  "policies":["policyId"],
  "metadata": { "any": "json" }
}
```

**DB (Postgres)**

```sql
CREATE TABLE kernel_division_manifest (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  goals jsonb NOT NULL,
  budget numeric(18,4),
  kpis jsonb,
  policies jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_division_manifest_name ON kernel_division_manifest(name);
```

**Required fields:** `id`, `name`, `goals`.

---

## 2) ManifestSignature

**Purpose:** A signature record describing a manifest that was signed by Kernel or an authorized signer.

**API shape**

```json
{
  "manifestId":"string",
  "signerId":"string",
  "signature":"base64-ed25519",
  "version":"string",
  "ts":"2025-01-01T00:00:00Z"
}
```

**DB**

```sql
CREATE TABLE kernel_manifest_signature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id text NOT NULL,
  signer_id text NOT NULL,
  signature text NOT NULL,
  version text,
  ts timestamptz NOT NULL
);
CREATE INDEX idx_manifest_signature_manifest ON kernel_manifest_signature(manifest_id);
```

**Notes:** `manifestId` may refer to division manifests, agent templates, upgrade manifests, etc.

---

## 3) AuditEvent

**Purpose:** Immutable append-only audit event for every critical action (create/update/delete/sign/decide).

**API shape**

```json
{
  "id":"uuid",
  "type":"string",
  "payload": { "any": "json" },
  "ts":"2025-01-01T00:00:00Z",
  "prevHash":"hex",
  "hash":"hex",
  "signature":"base64-ed25519"
}
```

**DB**

```sql
CREATE TABLE kernel_audit_event (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL,
  ts timestamptz NOT NULL,
  prev_hash text,
  hash text NOT NULL,
  signature text NOT NULL
);
CREATE INDEX idx_audit_event_ts ON kernel_audit_event(ts DESC);
```

**Notes**

* `hash` is SHA-256 of canonicalized payload + meta.
* `prevHash` links chain. Chain verification must be possible offline.
* Audit events referencing manifests should include `manifestSignatureId` inside payload.

---

## 4) AgentTemplate

**Purpose:** Signed template describing agent behavior and runtime requirements.

**API shape**

```json
{
  "id":"uuid",
  "name":"string",
  "description":"string",
  "codeRef":"string",
  "manifest": { "templateCfg": "..." },
  "resourceLimits": { "cpu": 1.0, "memoryMB": 2048, "gpuCount": 0 },
  "env": { "KEY":"value" },
  "signerId":"string",
  "signature":"base64-ed25519",
  "version":"string",
  "createdAt":"timestamp",
  "createdBy":"string"
}
```

**DB**

```sql
CREATE TABLE agent_template (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text,
  code_ref text NOT NULL,
  manifest jsonb NOT NULL,
  resource_limits jsonb,
  env jsonb,
  signer_id text,
  signature text,
  version text,
  created_at timestamptz DEFAULT now(),
  created_by text
);
CREATE INDEX idx_agent_template_code_ref ON agent_template(code_ref);
```

**Required:** `id`, `name`, `codeRef`, `manifest`, `signature`.

---

## 5) AgentInstance (AgentProfile / AgentRecord)

**Purpose:** Runtime representation of a running agent.

**API shape**

```json
{
  "id":"uuid",
  "templateId":"uuid",
  "role":"string",
  "divisionId":"uuid",
  "state":"created|provisioning|provisioned|starting|running|paused|stopping|stopped|failed|destroyed",
  "codeRef":"string",
  "resourceAllocation": { "cpu":1.0, "gpu":0, "memoryMB": 2048, "node":"node-id" },
  "host":"string",
  "lastHeartbeat":"timestamp",
  "health": { "liveness":"ok|failed", "readiness":"ok|failed", "lastCheckTs":"timestamp" },
  "score": 0.0,
  "logsUrl":"string",
  "createdAt":"timestamp",
  "updatedAt":"timestamp",
  "owner":"string"
}
```

**DB**

```sql
CREATE TABLE agent_instance (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL,
  role text,
  division_id uuid,
  state text NOT NULL,
  code_ref text,
  resource_allocation jsonb,
  host text,
  last_heartbeat timestamptz,
  health jsonb,
  score double precision,
  logs_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  owner text
);
CREATE INDEX idx_agent_instance_state ON agent_instance(state);
CREATE INDEX idx_agent_instance_division ON agent_instance(division_id);
```

**Notes:** Agent lifecycle transitions must be single-writer per-agent to avoid races.

---

## 6) AgentActionRecord

**Purpose:** Track lifecycle actions requested against an agent (start/stop/restart/destroy/etc).

**API shape**

```json
{
  "id":"uuid",
  "agentId":"uuid",
  "action":"start|stop|restart|destroy|pause|resume",
  "requestedBy":"string",
  "ts":"timestamp",
  "result":"ok|failed|pending",
  "notes":"string"
}
```

**DB**

```sql
CREATE TABLE agent_action_record (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL,
  action text NOT NULL,
  requested_by text,
  ts timestamptz NOT NULL,
  result text,
  notes text
);
CREATE INDEX idx_agent_action_agent ON agent_action_record(agent_id);
```

---

## 7) EvalReport

**Purpose:** Reports about agent behavior/metrics used by Eval Engine.

**API shape**

```json
{
  "id":"uuid",
  "agentId":"uuid",
  "metricSet": { "accuracy": 0.9, "latencyMs": 120 },
  "timestamp":"timestamp",
  "metadata": {}
}
```

**DB**

```sql
CREATE TABLE kernel_eval_report (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL,
  metric_set jsonb NOT NULL,
  timestamp timestamptz NOT NULL,
  metadata jsonb
);
CREATE INDEX idx_eval_agent_ts ON kernel_eval_report(agent_id, timestamp DESC);
```

---

## 8) MemoryNode & Artifact

**MemoryNode** — canonical stored atomic knowledge.
**Artifact** — large artifact metadata for S3 objects.

**API shapes**

```json
MemoryNode {
  "id":"uuid",
  "embeddingId":"string|null",
  "metadata":{},
  "createdAt":"timestamp",
  "owner":"string",
  "manifestSignatureId":"uuid|null"
}

Artifact {
  "id":"uuid",
  "path":"s3://bucket/key",
  "checksum":"sha256",
  "owner":"string",
  "size":12345,
  "manifestSignatureId":"uuid"
}
```

**DB**

```sql
CREATE TABLE memory_node (
  id uuid PRIMARY KEY,
  embedding_id text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  owner text,
  manifest_signature_id uuid
);
CREATE INDEX idx_memory_node_embedding ON memory_node(embedding_id);

CREATE TABLE artifact (
  id uuid PRIMARY KEY,
  path text NOT NULL,
  checksum text,
  owner text,
  size bigint,
  manifest_signature_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_artifact_checksum ON artifact(checksum);
```

**Notes:** Embeddings live in vector DB; `embeddingId` ties MemoryNode row to vector DB entry.

---

## 9) AllocationRequest / AllocationRecord

**Purpose:** Request & lifecycle for compute/capital allocations.

**API**

```json
AllocationRequest {
  "id":"uuid",
  "divisionId":"uuid",
  "cpu": 1.0,
  "gpu": 0,
  "memoryMB": 4096,
  "requester":"string",
  "status":"requested|pending|approved|applied|rejected",
  "createdAt":"timestamp",
  "appliedAt":"timestamp|null"
}
```

**DB**

```sql
CREATE TABLE allocation_request (
  id uuid PRIMARY KEY,
  division_id uuid,
  cpu double precision,
  gpu integer,
  memory_mb integer,
  requester text,
  status text,
  created_at timestamptz DEFAULT now(),
  applied_at timestamptz
);
CREATE INDEX idx_alloc_division ON allocation_request(division_id);
CREATE INDEX idx_alloc_status ON allocation_request(status);
```

---

## 10) PolicyCheck (SentinelNet)

**Purpose:** Records a policy decision.

**API**

```json
{
  "id":"uuid",
  "policyId":"string",
  "decision":"allow|deny|quarantine",
  "rationale":"string",
  "confidence": 0.95,
  "evidence": [ "auditEventId", "metricSnapshotId" ],
  "ts":"timestamp"
}
```

**DB**

```sql
CREATE TABLE policy_check (
  id uuid PRIMARY KEY,
  policy_id text,
  decision text,
  rationale text,
  confidence double precision,
  evidence jsonb,
  ts timestamptz NOT NULL
);
CREATE INDEX idx_policy_check_policy ON policy_check(policy_id);
```

---

## 11) ReasonNode / ReasonEdge / Snapshot

**ReasonNode**

```json
{
  "id":"uuid",
  "type":"decision|recommendation|evidence|explanation",
  "payload": {...},
  "manifestSignatureId":"uuid|null",
  "ts":"timestamp"
}
```

**ReasonEdge**

```json
{ "id":"uuid", "from":"nodeId", "to":"nodeId", "metadata":{} }
```

**Snapshot**

```json
{ "id":"uuid", "rootNodeId":"uuid", "hash":"sha256", "signature":"base64-ed25519", "s3Path":"s3://...", "ts":"timestamp" }
```

**DB**

```sql
CREATE TABLE reason_node (id uuid PRIMARY KEY, type text, payload jsonb, manifest_signature_id uuid, ts timestamptz);
CREATE TABLE reason_edge (id uuid PRIMARY KEY, from_node uuid, to_node uuid, metadata jsonb);
CREATE TABLE reason_snapshot (id uuid PRIMARY KEY, root_node uuid, hash text, signature text, s3_path text, ts timestamptz);
CREATE INDEX idx_reason_node_type ON reason_node(type);
```

---

## 12) Indexes, constraints & observability hints

* Add foreign key constraints where appropriate (e.g., `agent_instance.template_id` → `agent_template.id`). If your architecture requires looser coupling, enforce referential integrity in service logic.
* Partition large tables by time (e.g., `kernel_audit_event` by month) for scale.
* Add TTL or soft-delete flags for memory nodes as required by retention policies.
* Emit metrics for writes/reads per model; include `traceId` in audit events for tracing.

---

## 13) Example: creating an AuditEvent (canonicalization)

1. Canonicalize event payload (deterministic JSON ordering).
2. Compute `hash = sha256(canonicalPayload)`.
3. Request KMS to sign `hash` → `signature`.
4. Persist `AuditEvent` with `prevHash`, `hash`, `signature`.
5. Emit event to audit sink (Kafka/S3) and confirm archival.

---

## Final notes

* These shapes are intentionally conservative and minimal. Downstream modules must not invent fields without updating this document.
* All important manifests and snapshots require a `ManifestSignature`. The Kernel enforces that signed manifests are required for trusted actions (e.g., template registration, promotion, policy activation).
* Keep this document updated whenever `openapi.yaml` changes. `components/schemas` in `openapi.yaml` must match these model definitions.

---

## Acceptance (for kernel/data-models.md)

* `openapi.yaml` `components/schemas` and `kernel/data-models.md` must be consistent (field names/types).
* Security Engineer should review `ManifestSignature` and `AuditEvent` flows (KMS signing & verification).
* Implementations must be able to create and verify the audit chain from `AuditEvent` records.

