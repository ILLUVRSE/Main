# Agent Manager — Core Module

## # Purpose
The Agent Manager is the authoritative runtime for creating, running, and managing autonomous agents in ILLUVRSE. It instantiates Kernel-signed AgentTemplates, enforces resource and security policies, reports health and telemetry, and emits auditable lifecycle events to the Kernel and Event Bus.

This README aligns Agent Manager to the IDEA Creator API / Kernel submit vision: agents must be created in IDEA, signed by Kernel, and then instantiated and operated by the Agent Manager with full provenance and auditability.

(See IDEA Creator API + Kernel Submit contract for the submission/signing flow.)

## # Location
All files for the Agent Manager live under:
`~/ILLUVRSE/Main/agent-manager/`

## # Files in this module
- `agent-manager-spec.md` — high-level specification and responsibilities.  
- `agent-manager-api.md` — external API reference (endpoints Kernel calls).  
- `README.md` — this file.  
- `acceptance-criteria.md` — acceptance tests and verifiable checks (to be created).  
- `deployment.md` — deployment guidance and infra notes (to be created).  
- `.gitignore` — local ignores for runtime files (to be created).

## # How to use this module
1. Read `agent-manager-spec.md` and the IDEA Creator API to understand Agent lifecycle semantics, required payloads, and signing/audit requirements.  
2. Implement the Agent Manager service to:
   * Accept mTLS calls from Kernel for template registration and instantiation.
   * Verify Kernel-signed manifests (manifest + Kernel signature) prior to accepting templates.
   * Enforce resource allocations via the Resource Allocator and SentinelNet policy checks prior to provisioning.
   * Instantiate containers/VMs/pods for agents with secrets injected via Vault and enforce sandboxing/sandbox networking.
   * Emit auditable lifecycle events (agent_created, agent_started, agent_heartbeat, agent_stopped, agent_destroyed) to the Kernel Event Bus and audit log, linking to manifestSignatureId and artifact SHA256.
3. Implement heartbeats, graceful restart, and health endpoints so Kernel and operator tooling can monitor agent state and take remediation actions.

## # Security & compliance
- Service-to-service calls must use **mTLS**.  
- Template registration must only succeed for Kernel-signed templates; reject unsigned or tampered manifests.  
- Secrets must be injected at runtime using Vault; never store secrets in git or logs.  
- Enforce least privilege, sandboxing, and process / network isolation.  
- High-risk lifecycle actions must integrate with SentinelNet for policy gating.

## # Observability & metrics
Provide:
- Heartbeat/health endpoints and agent metrics (`agent.uptime`, `agent.cpu`, `agent.memory`, `agent.requests`) and lifecycle event counts.  
- Traces that include agent_id and manifestSignatureId.  
- Alerts when agents fail to heartbeat or exceed policy limits.

## # Acceptance & sign-off
Agent Manager is accepted when:
* Template registration only succeeds for Kernel-signed templates.  
* Instantiation path completes with provenance and audit events (manifestSignatureId, artifact_sha256 recorded).  
* Lifecycle actions (`start/stop/restart/destroy`) are auditable and testable.  
* Heartbeat/health transitions and metrics are emitted and searchable.  
* Security rules (sandboxing, secrets injection, SentinelNet policy) are enforced in tests.

Final approver: **Ryan (SuperAdmin)**. Security Engineer must review KMS/Vault integration and SentinelNet hooks.

## # Next single step
Create `acceptance-criteria.md` for the Agent Manager (one file). When you’re ready, reply **“next-agent-manager”** and I will provide the exact content for that single file.

