# SentinelNet — Specification

## Purpose
Real-time enforcement & explainable policy engine for platform actions.

## Policy model
- Policies expressed as structured rules with severity, scope (division/agent), and remediation.
- Evidence connectors: audit event pointers, metrics snapshots, artifact references.

## API
### `POST /sentinelnet/check`
- Body: `{ action, actor, resource, context }`
- Response: `{ decision: allow|deny|quarantine|remediate, rationale, evidence_refs }`

### `POST /sentinelnet/policy`
- Create/Modify policy with version and metadata.
- Support `simulate=true`.

### `GET /sentinelnet/policy/{id}/explain`
- Returns policy text, rationale, change history.

### Event subscription
- Subscribe to audit event stream for asynchronous detection.

## Explainability
- Decision response must include `policyId`, `policyVersion`, `evidenceRefs`.

## Auditing
- Each decision must emit `policyCheck` audit event signed and linked to evidence.

