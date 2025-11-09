# Agent Manager — Acceptance Criteria

The Agent Manager must implement secure, auditable lifecycle operations for Kernel-signed templates and live agents.

## # 1) Template registration
- Only Kernel-signed manifests accepted. Automated tests attempt unsigned manifest (should fail) and signed manifest (should succeed).
- Registered template contains `manifestSignatureId`, `artifact_sha256`, `metadata`, and `owner`.

## # 2) Instantiation & lifecycle
- Instantiation from a registered template succeeds and returns `agentId`.
- Lifecycle actions: start/stop/restart/destroy succeed and generate audit events.
- Heartbeat: agent reports `last_seen` and health; system transitions are testable.

## # 3) Resource policy & SentinelNet
- Pre-provision check against Resource Allocator and SentinelNet must be performed and enforced.
- Attempt to instantiate without resources fails with clear diagnostics.

## # 4) Secrets & sandboxing
- Agent's runtime receives secrets injected via Vault; secrets not persisted to logs.
- Sandbox enforces CPU/memory/network limits and enforces policy (no external network unless whitelisted).

## # 5) Audit & provenance
- All lifecycle events are audit-logged containing `manifestSignatureId`, `actor_id`, `agent_id`, and `artifact_sha256`.
- Audit chain verified with `hash` + `prevHash` + `signature`.

## # 6) Observability
- Expose metrics: `agent.instantiation.count`, `agent.heartbeat.latency`, `agent.uptime`.
- Provide health endpoints and traces that include `agent_id`.

## # 7) E2E test playbook
- Register signed template → instantiate → wait for heartbeat → run policy violation simulation → destroy → verify audit events and signatures.

