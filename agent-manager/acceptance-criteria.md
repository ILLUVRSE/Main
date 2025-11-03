# Agent Manager — Acceptance Criteria

Purpose: clear, testable checks that prove the Agent Manager is correct, secure, and production-ready. Each criterion is verifiable and minimal.

---

# # 1) Template registration & signature verification
- **Requirement:** AgentTemplate registration succeeds only when a valid Kernel `ManifestSignature` is provided.
- **How to verify:** Attempt to register a template with a valid Kernel signature → success. Attempt with an invalid/absent signature → API returns `403` and no template persisted.

# # 2) Instantiate flow (end-to-end)
- **Requirement:** Instantiation from template → provisioning → running completes and records provenance.
- **How to verify:** Call `POST /agent-manager/instantiate` for a signed template and division. Verify sequence: allocation request → SentinelNet check → provision → fetch image → inject secrets → start → health OK → `running` state. Confirm `agent.instantiated` and `agent.state.change` audit events were emitted with provenance (image digest, codeRef, node).

# # 3) Resource allocation integration
- **Requirement:** Agent Manager requests allocations and waits for Resource Allocator approval; rejected allocations block provisioning.
- **How to verify:** Simulate Resource Allocator approval → provisioning proceeds. Simulate rejection → provisioning aborts, API returns `403`/error, and audit event records policy id.

# # 4) SentinelNet policy enforcement
- **Requirement:** Pre-provision and runtime SentinelNet policy checks run; SentinelNet can block/quarantine actions.
- **How to verify:** Deploy a test policy that rejects a known action (e.g., egress to disallowed domain). Attempt action → Agent Manager returns `403` and audit event includes `policyId` + rationale. At runtime SentinelNet decision should alter agent behavior (quarantine or revoke).

# # 5) Provenance & auditability
- **Requirement:** Every agent instance stores a provenance snapshot at start: `codeRef`, image digest, node, runtime config; snapshot is emitted to audit bus.
- **How to verify:** After agent reaches `running`, call `GET /agent-manager/agent/{id}/provenance` and confirm fields. Confirm corresponding `audit` event exists with same data and valid signature/hash.

# # 6) Lifecycle actions & state transitions
- **Requirement:** `start`, `stop`, `pause`, `resume`, `restart`, `destroy` operate correctly and emit `AgentActionRecord` + audit events. Invalid transitions return `409` and are not applied.
- **How to verify:** Drive each lifecycle action and assert state transitions, response codes, and emitted audit events. Test invalid transitions (e.g., start a running agent) to ensure proper error.

# # 7) Heartbeat, health checks & failure handling
- **Requirement:** Heartbeats update `lastHeartbeat`; missing N heartbeats marks `failed` and emits audit event. Health probes change readiness/liveness and are reflected in state.
- **How to verify:** Stop sending heartbeats and confirm state moves to `failed` after threshold and audit event created. Simulate liveness failure → agent marked accordingly.

# # 8) Secrets & vault integration
- **Requirement:** Secrets injected at runtime from Vault (or equivalent) and never persisted to DB or logs. Secrets access is auditable.
- **How to verify:** Start an agent that requires secrets; confirm secrets are available to runtime, not stored in DB/logs, and an audit entry records the secrets fetch reference (not the secret itself).

# # 9) Isolation & runtime security
- **Requirement:** Agents run in sandboxed environments with network/effect controls. Egress rules and mounts enforced.
- **How to verify:** Attempt forbidden outbound connection from agent and confirm it is blocked. Verify disk/mount restrictions by attempting to access host-only paths.

# # 10) Observability (metrics & logs)
- **Requirement:** Agent Manager exposes metrics for provisioning latency, active agents, failed starts, and heartbeat gaps. Logs are available per agent via `logsUrl` or central store.
- **How to verify:** Run load/provisioning tests and confirm metrics are emitted to Prometheus (or metric sink). Confirm logs are written and searchable by `agentId`.

# # 11) Provenance for destroy/cleanup
- **Requirement:** Destroy flushes logs, revokes secrets, frees allocations, and emits a final provenance snapshot and `agent.destroyed` audit event.
- **How to verify:** Destroy an agent and confirm final audit/provenance record and freed resources.

# # 12) Idempotency & retries
- **Requirement:** `instantiate` and lifecycle actions support idempotency keys; retries do not create duplicates.
- **How to verify:** Send duplicate `instantiate` requests with same idempotency key and confirm only one agent created.

# # 13) Tests & automation
- **Requirement:** Unit tests for signature validation, template verification, and lifecycle logic; integration tests for full instantiate → run → stop.
- **How to verify:** Run test suite; unit/integration tests pass in CI. Coverage should include critical paths (signature verification, SentinelNet rejection, resource rejection).

# # 14) Performance & scale
- **Requirement:** Agent Manager handles provisioning scale target (documented target X agents/min per cluster) and supports horizontal scaling (leader election or sharding).
- **How to verify:** Run a scale test to target and confirm provisioning latency within documented threshold and no data loss in audit events.

# # 15) Security & compliance
- **Requirement:** No secrets in repo or DB. mTLS enforced for Kernel→Agent Manager communication. Agent Manager only accepts signed templates and validates Kernel signerId.
- **How to verify:** Inspect code/config for secrets; confirm mTLS is mandatory and test an unauthenticated client is rejected.

# # 16) Documentation & sign-off
- **Requirement:** `agent-manager-spec.md`, `agent-manager-api.md`, `README.md`, and this acceptance criteria file exist and are approved. Security Engineer and Ryan must sign off.
- **How to verify:** Confirm files present and obtain written approval recorded as an audit event (or commit with signed message).

---

# # Final acceptance statement
Agent Manager is accepted when all above checks pass, automated tests are green, audit events validate, SentinelNet integration works, and formal sign-off by Ryan and the Security Engineer is recorded.


