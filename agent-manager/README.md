# Agent Manager — Core Module

# # Purpose
The Agent Manager is the authoritative runtime for creating, running, and managing autonomous agents in ILLUVRSE. It instantiates signed AgentTemplates, enforces resource and security policies, reports health and telemetry, and emits auditable lifecycle events to the Kernel.

# # Location
All files for the Agent Manager live under:
~/ILLUVRSE/Main/agent-manager/

# # Files in this module
- `agent-manager-spec.md` — high-level specification and responsibilities.
- `agent-manager-api.md` — external API reference (endpoints Kernel calls).
- `README.md` — this file.
- `acceptance-criteria.md` — acceptance tests and verifiable checks (to be created).
- `deployment.md` — deployment guidance and infra notes (to be created).
- `.gitignore` — local ignores for runtime files (to be created).

# # How to use this module
1. Read `agent-manager-spec.md` to understand requirements, security, and lifecycle semantics.
2. Implement or wire Agent Manager services to accept mTLS calls from Kernel and to publish lifecycle audit events to the Kernel audit bus.
3. Follow `agent-manager-api.md` for exact endpoint expectations and payload shapes.
4. Implement secrets injection from Vault at runtime — do not store secrets in repo or logs.
5. Integrate with Resource Allocator and SentinelNet for pre-provision policy checks and runtime enforcement.

# # Acceptance & sign-off
Agent Manager is considered ready when:
- Template registration only succeeds for Kernel-signed templates.
- Instantiation path completes with provenance and audit events.
- Lifecycle actions (`start/stop/restart/destroy`) function and are auditable.
- Heartbeat/health transitions and metrics are emitted and searchable.
- Security rules (sandboxing, secrets injection, SentinelNet policy) are enforced.
Final approver: **Ryan (SuperAdmin)**. Security Engineer must review KMS/Vault integration and SentinelNet hooks.

# # Next single step
Create `acceptance-criteria.md` for the Agent Manager (one file). When you’re ready, reply **“next”** and I’ll give the exact content for that single file.

---

End of README.

