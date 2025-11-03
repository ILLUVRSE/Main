# Kernel API Spec (Draft)

## # Purpose
The Kernel is the single canonical API gateway and governance layer for ILLUVRSE.
It enforces who can do what, signs important manifests, records immutable audit events, and is the authority for policy enforcement.

## # Core responsibilities
- Division registry (DivisionManifest management)
- Agent lifecycle (templates, spawn, stop, scale, health)
- Eval ingestion (receive evaluation reports)
- Resource allocation (compute and capital assignment)
- Reasoning trace retrieval (causal/decision traces)
- Manifest signing and provenance (Ed25519 signatures)
- Audit logging (append-only, signed events)
- SentinelNet hooks for real-time policy enforcement
- CommandPad hooks for manual override and governance

## # Minimal endpoints (name + intent)
- `POST /kernel/division` — register or update a DivisionManifest
- `GET  /kernel/division/{id}` — fetch a DivisionManifest
- `POST /kernel/agent` — spawn a new agent from a template
- `GET  /kernel/agent/{id}/state` — retrieve agent snapshot and recent metrics
- `POST /kernel/eval` — submit an EvalReport for an agent
- `POST /kernel/allocate` — request or assign compute / capital resources
- `POST /kernel/sign` — request a signature for a manifest (returns signature record)
- `GET  /kernel/audit/{id}` — fetch a signed audit event
- `GET  /kernel/reason/{node}` — retrieve a reasoning trace for a graph node

## # Canonical data models (required fields)
- `DivisionManifest` — `id`, `goals[]`, `budget`, `kpis[]`, `policies[]` (+ optional `metadata`)
- `AgentProfile` — `id`, `role`, `skills[]`, `code_ref`, `state`, `score`, `created_at`
- `EvalReport` — `id`, `agent_id`, `metric_set`, `timestamp`
- `MemoryNode` — `id`, `embedding?`, `metadata?`
- `ManifestSignature` — `manifest_id`, `signer_id`, `signature`, `version`, `ts`

## # Security & governance rules
- RBAC enforced on every endpoint. **SuperAdmin = Ryan.**
- Human auth via OIDC/SSO; service-to-service via mTLS.
- All critical manifests and audit events must be signed with Ed25519 keys stored in KMS/HSM.
- Kernel-level code/manifest upgrades require **multi-sig (3-of-5)** approval.
- SentinelNet evaluates policy on allocations and critical actions and can block or quarantine.
- All keys rotate per policy; access to signing keys is logged and limited.

## # Audit log & immutability
Every critical action produces an audit event placed on an append-only event stream. Events are chained (prev-hash) and signed so the chain is verifiable (SHA-256 + signature). Any manifest change must have a corresponding signed audit event linking the manifest, signer, timestamp, and rationale.

## # Minimal acceptance criteria
- A short OpenAPI-like list of the endpoints and models exists.
- RBAC and signing rules written clearly.
- Multi-sig upgrade flow described (who signs, quorum, process).
- An example audit event format and one example flow are documented.

## # Example flow (short)
Create a DivisionManifest → Kernel signs the manifest and emits an audit event → Agent Manager is allowed to spawn an agent using that manifest → the agent writes outputs to Memory Layer and the Eval Engine scores it → Eval emits promotion event that goes through Kernel and Resource Allocator after SentinelNet policy check.

## # Who signs off
Final approver: **Ryan**. Involve Security Engineer for KMS/HSM and the Technical Lead for the Agent Manager integration.

