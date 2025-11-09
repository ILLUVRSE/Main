# Agent Manager — Specification

## Purpose
Authoritative runtime for instantiating and managing Kernel-signed AgentTemplates.

## Security
- API protected by mTLS (Kernel → Agent Manager) and RBAC for human ops.
- Template registration *must* validate Kernel signature and signer KID.

## API (high-level)
### `POST /agent-manager/templates`
- Accepts: `{ manifest: object, signature: string, signer_kid: string }`
- Validations: canonicalization, signature verification, manifest schema, signer allowed.
- Response: `{ ok:true, template_id }` or `400/403`.

### `POST /agent-manager/templates/{template_id}/instantiate`
- Accepts: `{ overrides?: object, divisionId, requester }`
- Behavior:
  - Preflight: request Resource Allocator + SentinelNet check.
  - Provision: create runtime (container/pod/vm), inject secrets, start agent with `entrypoint`.
  - Emit audit event `agent_instantiated`.
- Response: `202 {"agentId":"uuid"}`

### `POST /agent-manager/agents/{agent_id}/action`
- Actions: `start|stop|restart|destroy`.
- Emits lifecycle audit event.

### `GET /agent-manager/agents/{agent_id}/status`
- Returns: `{ state, last_seen, metrics, manifestSignatureId }`

### Heartbeat & Health
- Agents must POST heartbeat to Agent Manager `POST /agent-manager/agents/{id}/heartbeat` with `metrics`.
- Agent Manager must surface agent health and produce `agent_heartbeat` events.

## Error handling & retries
- Transient provisioning errors retry with exponential backoff; persistent failures generate audit `agent_error` with diagnostics.

## Events & audit
- Emit audit events to Event Bus for each meaningful action: `template_registered`, `agent_instantiated`, `agent_heartbeat`, `agent_stopped`, `agent_destroyed`.

## Operational notes
- Secrets via Vault using short lived tokens per agent.
- Resource quotas enforce per-division limits configured via `division` manifests from Kernel.

