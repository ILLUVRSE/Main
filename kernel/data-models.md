# Kernel — Canonical Data Models

Purpose: concise, unambiguous definitions of the core models the Kernel and surrounding systems use.
API surfaces use **camelCase**. Database column names use **snake_case**. Persisted manifests and audit records are versioned and immutable where noted.

---

## # 1) DivisionManifest
**Intent:** authoritative description of a Division (goals, budget, KPIs, policies).

Fields (API / meaning / DB type):
- `id` — string (UUID); primary identifier. (postgres: uuid PK)
- `name` — string; human-friendly name. (varchar)
- `goals` — array[string]; top-level goals. (postgres: jsonb)
- `budget` — number; budget amount (principal currency managed elsewhere). (numeric)
- `currency` — string; ISO currency code, e.g., "USD". (varchar)
- `kpis` — array[string]; KPI identifiers or short descriptions. (jsonb)
- `policies` — array[string]; policy IDs that apply. (jsonb)
- `metadata` — object; free-form JSON for extra info (owner, tags). (jsonb)
- `status` — string enum: `active|paused|retired`. (varchar)
- `version` — string; manifest semantic version. (varchar)
- `createdAt`, `updatedAt` — timestamps. (timestamp with tz)
- `manifestSignatureId` — string (fk to ManifestSignature) — link to signature/audit record.

**Notes:** manifests are versioned and treated as append-only for auditability. Updates create a new version with a new signature/audit record.

Example:
```json
{
  "id":"dvg-1a2b-3c4d",
  "name":"Product",
  "goals":["build MVP","acquire first 10K users"],
  "budget":100000,
  "currency":"USD",
  "kpis":["activationRate","retention30"],
  "policies":["policy-budget-cap-v1"],
  "metadata":{"owner":"ryan"},
  "status":"active",
  "version":"1.0.0",
  "createdAt":"2025-01-10T12:00:00Z"
}

2) AgentProfile

Intent: runtime record for an agent instance.

Fields:

id — string (UUID).

templateId — string (optional) — links to AgentTemplate.

role — string (e.g., "GrowthHacker").

skills — array[string].

codeRef — string (git URL + ref or image URI).

divisionId — string (fk to DivisionManifest).

state — enum: stopped|running|paused|failed.

score — number (current aggregate performance).

resourceAllocation — object (cpu, gpu, memory).

lastHeartbeat — timestamp.

createdAt, updatedAt — timestamps.

owner — string (team or user).
Example:

{
  "id":"agent-abc123",
  "templateId":"growth-v1",
  "role":"GrowthHacker",
  "skills":["outreach","ads"],
  "codeRef":"git@github.com:ILLUVRSE/agents.git#growth-v1",
  "divisionId":"dvg-1a2b-3c4d",
  "state":"running",
  "score":0.83,
  "lastHeartbeat":"2025-01-12T08:30:00Z"
}

Indexes: index on division_id, state, last_heartbeat.

3) EvalReport

Intent: a single evaluation submission for an agent.

Fields:

id — uuid.

agentId — uuid (fk).

metricSet — object (arbitrary key → value; numeric or categorical). (jsonb)

timestamp — timestamp.

source — string (which system produced it).

computedScore — number (optional cached score).

window — string (optional window/period).

Example:
{
  "id":"eval-001",
  "agentId":"agent-abc123",
  "metricSet":{"taskSuccess":0.9,"latencyMs":110},
  "timestamp":"2025-01-12T09:00:00Z",
  "source":"sim-runner"
}

Indexes: agent_id + timestamp for fast recent-evals queries.

4) MemoryNode

Intent: persistent memory item. Embeddings live in vector store; metadata and trace live in Postgres.

Fields:

id — uuid.

text — string (optional short blob / content) — stored if small.

embeddingId — string (id used in vector DB); the full numeric vector is stored in vector DB, not Postgres.

metadata — jsonb (source, tags, owner, references).

createdAt — timestamp.

ttl — optional expiry policy.

Storage pattern:

Postgres table memory_nodes holds id, text (nullable), metadata, created_at.

Vector DB stores embedding under embeddingId with metadata containing memory_node_id to join.

5) ManifestSignature

Intent: record that a manifest was signed.

Fields:

id — uuid.

manifestId — string (id of manifest signed).

signerId — string (key identifier).

signature — base64 string.

version — string.

ts — timestamp.

prevHash — optional SHA-256 of previous audit chain entry.

Example:
{
  "id":"sig-01",
  "manifestId":"dvg-1a2b-3c4d",
  "signerId":"kernel-signer-1",
  "signature":"BASE64_SIG",
  "version":"1.0.0",
  "ts":"2025-01-10T12:00:10Z"
}

6) AuditEvent

Intent: immutable event on the append-only audit bus.

Fields:

id — uuid.

eventType — string (e.g., manifest.update, agent.spawn, allocation).

payload — jsonb (event content).

prevHash — text (hex SHA-256 of prior event).

hash — text (SHA-256 of this event payload + prevHash).

signature — base64.

signerId — string.

ts — timestamp.

Storage: events are stored in append-only storage (Kafka topics + persistent sink in S3/Postgres). Each event must be verifiable via hash chain + signature.

7) AgentTemplate (optional but recommended)

Intent: versioned template used to instantiate agents.

Fields:

id — string.

name — string.

manifest — jsonb (template metadata and args).

codeRef — string.

resourceLimits — object (cpu, gpuCount, memoryMB).

signerId, signature, version, createdAt.

8) ResourceAllocation

Intent: record of compute/capital assignment.

Fields:

id — uuid.

entityId — string (agentId/divisionId).

pool — string (compute pool id).

delta — number (positive/negative).

reason — string.

requestedBy — string (actor).

status — enum: pending|applied|rejected.

ts — timestamp.

Storage & implementation notes

API vs DB: API uses camelCase; DB uses snake_case. Keep a single mapping layer.

Embeddings: store vectors in a vector DB (Milvus/Pinecone). Keep memory_node.id as authoritative and join via embeddingId.

Postgres types: prefer jsonb for flexible fields, uuid for primary keys, numeric for money.

Indexes: create indexes on foreign keys and times: agent_id on evals, division_id on agents, created_at on manifests/audit.

Immutability & versioning: manifests and audit events are append-only; store previous versions rather than mutating. Use version and created_at for ordering.

Conventions: sign every manifest change; store manifestSignatureId on the manifest record as a pointer to the signature/audit event.

Minimal DB schema mapping (hint)

divisions (id uuid PK, name, goals jsonb, budget numeric, currency varchar, kpis jsonb, policies jsonb, metadata jsonb, status varchar, version varchar, manifest_signature_id uuid, created_at, updated_at)

agents (id uuid PK, template_id, role, skills jsonb, code_ref varchar, division_id uuid FK, state varchar, score numeric, last_heartbeat timestamp, created_at, updated_at)

eval_reports (id uuid PK, agent_id uuid FK, metric_set jsonb, timestamp)

memory_nodes (id uuid PK, text text, metadata jsonb, created_at, ttl)

manifest_signatures (id uuid PK, manifest_id varchar, signer_id varchar, signature text, version varchar, ts)

audit_events (id uuid PK, event_type varchar, payload jsonb, prev_hash text, hash text, signature text, signer_id varchar, ts)
