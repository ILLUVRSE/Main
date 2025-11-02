# Agent Manager — Specification

## Purpose
The Agent Manager is the authoritative service that instantiates, controls, and monitors autonomous agent instances for ILLUVRSE. It turns signed agent templates into running agents, enforces resource limits and security, reports health/metrics, and emits auditable lifecycle events to the Kernel audit bus.

The Agent Manager is **not** the Kernel — it is a governed, pluggable runtime that the Kernel authorizes and audits.

---

## Core responsibilities
- Manage AgentTemplates (register, version, sign pointer).  
- Instantiate AgentInstances from templates (provision resources, fetch code, configure environment).  
- Lifecycle operations: start, stop, pause, resume, restart, destroy.  
- Health & telemetry: heartbeat, liveness/readiness probes, logs, metrics, and traces.  
- Resource enforcement: CPU/GPU/memory limits, quotas, affinity/placement.  
- Provenance: ensure each instance links to signed template + manifest signature.  
- Security sandboxing: run agents in isolated containers/namespaces, enforce network/egress policies.  
- Auditability: emit `agent.spawn`, `agent.state.change`, `agent.heartbeat`, `agent.destroy` events to Kernel audit bus.  
- Integration: work with Kernel (auth/signatures), AI & Infra (model access), Resource Allocator (requests/updates), and SentinelNet (policy checks).

---

## Minimal external API (name + intent)
These endpoints are Agent Manager’s external API (the Kernel calls these).

- `POST /agent-manager/templates` — register a new AgentTemplate (payload: template JSON, codeRef, resourceLimits, signerId/signature).  
- `GET  /agent-manager/templates/{id}` — fetch template manifest and signature.  
- `POST /agent-manager/instantiate` — create an AgentInstance from a template (payload: templateId, divisionId, overrides, requester). Returns `agentId`.  
- `GET  /agent-manager/agent/{id}/state` — get runtime state, lastHeartbeat, resourceAllocation, and recent events.  
- `POST /agent-manager/agent/{id}/action` — perform lifecycle action (`start|stop|pause|resume|restart|destroy`).  
- `GET  /agent-manager/agents` — list agents with filters (divisionId, state, templateId).  
- `POST /agent-manager/agent/{id}/heartbeat` — agent heartbeats in (agent->manager) or manager updates when seen.  
- `POST /agent-manager/agent/{id}/logs` — ingest logs (or pointer to log store).  
- `POST /agent-manager/agent/{id}/metrics` — ingest metrics/telemetry or expose scrape endpoint.

**Notes:** All mutate operations require Kernel authorization (mTLS + RBAC) and must be recorded to the Kernel audit log. Template registration requires a manifest signature from Kernel or an approved signer.

---

## Canonical data models (short)

### AgentTemplate
- `id` — string (uuid).  
- `name` — string.  
- `description` — string.  
- `codeRef` — git url, image uri, or artifact pointer.  
- `manifest` — json (template config).  
- `resourceLimits` — { cpu, memoryMB, gpuCount, diskMB }.  
- `env` — map[string]string (default env vars).  
- `signerId` / `signature` — link to Kernel ManifestSignature.  
- `version` — string.  
- `createdAt`, `createdBy`.

### AgentInstance (AgentProfile / AgentRecord)
- `id` — uuid.  
- `templateId` — uuid.  
- `role` — string.  
- `divisionId` — uuid.  
- `state` — enum: `created|provisioning|provisioned|starting|running|paused|stopping|stopped|failed|destroyed`.  
- `codeRef` — resolved codeRef used at runtime.  
- `resourceAllocation` — object (cpu, gpu, memory, node).  
- `host` — host/container id or node reference.  
- `lastHeartbeat` — timestamp.  
- `health` — { liveness: ok/failed, readiness: ok/failed, lastCheckTs }.  
- `score` — numeric (from Eval).  
- `logsUrl` — optional pointer.  
- `createdAt`, `updatedAt`, `owner`.

### AgentActionRecord
- `id`, `agentId`, `action` (`start|stop|restart|destroy|pause|resume`), `requestedBy`, `ts`, `result`, `notes`.

---

## Security & provenance
- Templates must be signed (ManifestSignature) before the Agent Manager will instantiate them. The Agent Manager verifies the signature against Kernel’s Key Registry.  
- Instances carry the template’s signature and a runtime provenance record: exact codeRef commit, container digest, deployment node, and runtime config. This provenance is emitted as an audit event.  
- Agents run in sandboxed environments (containers, k8s pods, or VMs) with network policies and least-privilege mounts. Sensitive secrets must be injected at runtime from Vault, not baked into images.  
- The Agent Manager enforces network egress rules and blocks forbidden outbound connections as defined by SentinelNet policies.

---

## Resource model & placement
- Resource requests are honored only after Resource Allocator approval and SentinelNet policy check. The Kernel coordinates allocation requests; Agent Manager must validate the allocation before provisioning.  
- Placement strategies: bin-packing by GPU, affinity/anti-affinity by division, and locality preferences.  
- Support preemption and soft quotas: Agent Manager can evict low priority agents subject to audit and policy.

---

## Health, telemetry & observability
- Agents must heartbeat at an agreed interval. Missing N heartbeats marks agent as `failed` and emits an audit event.  
- Expose standard metrics (uptime, CPU, memory, GPU utilization, request/response latencies) via Prometheus or push model.  
- Log retention policy and pointer to centralized log store (S3 / ELK). Logs and traces are auditable and indexed per agentId.

---

## Lifecycle & operational rules
- Instantiation is multi-step: validate signed template → request allocation → provision resources → fetch code/image → configure secrets → start container → run health probes → mark `running`. Each step emits audit events.  
- Stop/destroy must gracefully shut down, flush logs, revoke secrets, and free allocations. Destroy emits final provenance snapshot.  
- Automatic restart policy configurable per template (never, on-failure, always). Restarts tracked and rate-limited to avoid flapping.

---

## Integration points
- **Kernel**: authorization, template signature verification, audit bus (write events), resource allocation requests, SentinelNet policy calls.  
- **AI & Infra**: for fetching models, accessing model endpoints, and GPU scheduling.  
- **Resource Allocator**: request and confirm compute/capital allocations.  
- **SentinelNet**: pre-provision policy check and runtime enforcement hooks.  
- **Memory Layer**: agents read/write MemoryNode artifacts as needed (through secure APIs).

---

## Audit & events
- Emit auditable events for: `template.registered`, `agent.instantiated`, `agent.state.change`, `agent.heartbeat`, `agent.metrics`, `agent.logs`, `agent.destroyed`. Events must include `agentId`, `templateId`, `provenance`, `host`, `resourceAllocation`, `ts`, and be signed or recorded by Kernel’s audit path.

---

## Acceptance criteria (minimal, testable)
- Template registration only succeeds with a valid Kernel signature.  
- Instantiation flow completes end-to-end and results in a `running` agent with provenance recorded.  
- Lifecycle actions (`start/stop/restart/destroy`) work and are auditable.  
- Heartbeat and health transitions update state and emit audit events. Missing heartbeats mark `failed`.  
- Resource allocation integration: Agent Manager requests allocation, waits for approval, and enforces limits. Rejected allocations prevent provisioning.  
- SentinelNet can block provisioning and runtime actions; blocked actions are logged and returned to caller with policy id.  
- Agents run in an isolated sandbox with secrets injected from Vault (no secret in repo).  
- Observability: metrics and logs available per agent and searchable by `agentId`.  
- Tests: unit tests for signature verification and lifecycle logic; integration tests for full instantiate → run → stop flow.  

---

## Example flow (short)
1. Register `growth-v1` template with Kernel-signed manifest.  
2. Kernel calls `POST /agent-manager/instantiate` for division `dvg-1`.  
3. Agent Manager verifies signature, requests allocation from Resource Allocator, SentinelNet approves, Agent Manager provisions resources, pulls image at digest, injects secrets from Vault, starts container, runs health checks, and emits `agent.instantiated` and `agent.state.change` (`running`) audit events.

---

## Operational notes & scaling
- Scale by running multiple Agent Manager instances with leader election for provisioning coordination, or shard responsibilities by division/region.  
- Use a database for authoritative agent state and a fast in-memory cache for recent heartbeats.  
- Keep single-writer semantics for per-agent state transitions to avoid races.


