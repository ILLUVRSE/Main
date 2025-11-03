# SentinelNet — Policy & Enforcement Engine Specification

## Purpose

SentinelNet is the real-time policy engine and autonomous enforcement
layer for ILLUVRSE. It evaluates policies over API calls, audit events,
resource allocations, model actions, and agent behavior; it decides
allow/deny/quarantine/remediate; and it records its decisions as
auditable events. SentinelNet ensures governance, safety, and automated
compliance across the Kernel and all divisions.

---

## High-level responsibilities

- Evaluate policy rules in real time for incoming API requests,
  allocation proposals, and agent actions.  

- Enforce decisions: allow, deny, quarantine, or trigger an automated
  remediation action (revoke cert, reduce allocation, isolate agent).

- Score and prioritize alerts based on severity and confidence.

- Provide a policy authoring, versioning, and rollout system (policy
  registry) and a simulation/dry-run mode.

- Emit `policyCheck` audit events with rationale, confidence, and
  action taken.

- Integrate with Kernel, Resource Allocator, Agent Manager, Eval
  Engine, and Reasoning Graph for explainability and actions.

---

## Key concepts & data models

### Policy

- `policyId` — string (stable id)  
- `name`, `description`  
- `scope` — objects the policy applies to (`kernel`, `division`, `agent`,
  `allocation`, `manifest`, `retrain`, `marketplace`)  
- `conditions` — a declarative rule (see Policy Language)  
- `actions` — allowed outcomes (`allow|deny|quarantine|remediate|escalate`)  
- `severity`, `version`, `createdBy`, `createdAt`, `status`  
- `simMode` — boolean (if true, only log decisions; do not enforce)

### PolicyCheck (audit event)

- `id` — uuid  
- `policyId` — string  
- `requestId` — correlation id for evaluated action  
- `actor` — who initiated the action (service/agent/user)  
- `target` — object under check (allocation, manifestId, agentId)  
- `decision` — `allow|deny|quarantine|remediate|escalate`  
- `confidence` — numeric (0–1) or enumerated value  
- `rationale` — text explanation (rule matches, thresholds)  
- `timestamp` — ISO8601  
- `evidence` — pointers to audit events, metrics, or traces used

---

## Enforcement modes

- **Block / Deny:** Immediate rejection with `403` and `policyId`.  
- **Quarantine:** Allow action but isolate resulting resources and flag
  for manual review.  
- **Remediate:** Trigger an automated remediation (idempotent where
  possible) and record the outcome.  
- **Simulate:** Evaluate and log decisions without enforcement.  
- **Escalate:** Require manual or multi-sig approval before allowing the
  action.

---

## Integration points & flows

### API request gating (synchronous)

Kernel forwards mutations (division updates, allocation requests, sign
requests) to SentinelNet for a bounded-time synchronous policy check.
SentinelNet returns `decision`, `policyId`, `rationale`, and `confidence`.
Kernel honors the decision and SentinelNet emits a `policyCheck` event.

### Audit event consumption (asynchronous)

SentinelNet subscribes to the audit bus and retroactively evaluates
policies on streams of events. It can flag systems or generate
remediation actions based on historical patterns.

---

## Observability & explainability

Every decision contains a textual rationale and a structured `evidence`
array. Provide an explain endpoint:

GET /sentinel/explain/{policyCheckId}

This returns the evidence and the logical rule path that fired.

---

## Policy authoring & lifecycle

- Policy Registry with versioning, testing, and rollouts: draft → test
  (simulate) → canary → active → deprecated.  
- High-severity policy changes require multi-sig approval.  
- Provide rollback and an audit trail of who changed what.

---

## Acceptance criteria (minimal)

- Policy registry: create/update/list policies with versioning.  
- Sync checks: Kernel can call SentinelNet synchronously and receive
  decisions within SLO.  
- Audit events: SentinelNet emits `policyCheck` events with rationale.  
- Remediation: SentinelNet can trigger a sample remediation and record
  outcome.  
- Simulation: run policy in `simMode` and produce an impact report.

---

## Example policies (short)

1. **Budget cap** — deny allocations that would put a division over
   budget.

2. **High churn** — quarantine agent spawns when the spawn rate for a
   user exceeds N per minute.

3. **PII leakage** — deny manifests that contain detected PII unless a
   multi-sig ratifies the change.

4. **Signer age** — deny use of a signer key older than the rotation
   window or if the key is revoked.

