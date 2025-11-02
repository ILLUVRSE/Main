# SentinelNet — Policy & Enforcement Engine Specification

## Purpose
SentinelNet is the real-time policy engine and autonomous enforcement layer for ILLUVRSE. It evaluates policies over API calls, audit events, resource allocations, model actions, and agent behavior; it decides allow/deny/quarantine/remediate; and it records its decisions as auditable events. SentinelNet ensures governance, safety, and automated compliance across the Kernel and all divisions.

---

## High-level responsibilities
- Evaluate policy rules in real time for incoming API requests, allocation proposals, and agent actions.  
- Enforce decisions: allow, deny, quarantine, or trigger a remediation action (revoke cert, reduce allocation, isolate agent).  
- Score and prioritize alerts based on severity and confidence.  
- Provide a policy authoring, versioning, and rollout system (policy registry).  
- Offer simulation / dry-run mode for testing policies without enforcement.  
- Emit `policyCheck` audit events with full rationale, confidence, and action taken.  
- Provide an interface for humans (CommandPad) to review, override, or ratify decisions (multi-sig when needed).  
- Integrate with Kernel, Resource Allocator, Agent Manager, Eval Engine, and Reasoning Graph for explainability and actions.

---

## Key concepts & data models

### Policy
- `policyId` — string (stable id)  
- `name`, `description`  
- `scope` — the objects the policy applies to (`kernel`, `division`, `agent`, `allocation`, `manifest`, `retrain`, `marketplace`)  
- `conditions` — a declarative rule (see Policy Language)  
- `actions` — permitted enforcement outcomes (`allow|deny|quarantine|remediate|escalate`)  
- `severity` — `low|medium|high|critical`  
- `version`, `createdBy`, `createdAt`, `status` (`draft|active|deprecated`)  
- `simMode` — boolean (if true, only log decisions, do not enforce)

### PolicyCheck (audit event)
- `id` — uuid  
- `policyId` — string  
- `requestId` — correlation id for evaluated action  
- `actor` — who initiated the action (service/agent/user)  
- `target` — the object under check (allocation, manifestId, agentId)  
- `decision` — `allow|deny|quarantine|remediate|escalate`  
- `confidence` — numeric (0-1) or enumeration  
- `rationale` — text explanation (rule matches, thresholds)  
- `timestamp` — ISO8601  
- `actionTaken` — optional remediation details (commands executed or triggers)  
- `evidence` — pointers to audit events, metrics, or traces used to make decision

### RemediationAction
- `id`, `type` (`revoke_cert|reduce_allocation|isolate_agent|block_egress|notify`), `target`, `executedBy`, `ts`, `result`, `notes`

---

## Policy language & rule model (high-level)
- Policies are declarative, JSON/YAML representations combining boolean logic, numeric thresholds, time windows, and references to external signals (audit counts, budget usage, model confidence, agent score).  
- Example building blocks:
  - `metric(rule)`: evaluate numeric metrics (e.g., `agent.score < 0.2` over last 24h).  
  - `budget(rule)`: compare requested delta with remaining budget.  
  - `signature(rule)`: check signerId, signature age, or missing signatures.  
  - `rate(rule)`: detect spikes (e.g., more than N creates per minute).  
  - `pii(rule)`: detect PII in payload (via pattern matching or ML classifier).  
  - `policy_ref(rule)`: reference other policy outcomes.  
- Policies can combine conditions with `AND`, `OR`, `NOT`.  
- Policies can reference **policy sets** and specify escalation and ratification hooks (multi-sig).  
- Policies support `pre` (pre-action) and `post` (post-action) evaluations.

---

## Enforcement modes
- **Block / Deny:** Immediate rejection of the request with clear error (`403`) and `policyId` returned. Audit event emitted.  
- **Quarantine:** Allow action but isolate resulting resources (e.g., place agent in restricted network, mark allocation as `quarantined`) and flag for manual review.  
- **Remediate:** Trigger an automated remediation action (e.g., reduce allocation, revoke key). Record action result and emit audit.  
- **Simulate:** Evaluate and log decisions but do not enforce — used for testing policy impact.  
- **Escalate:** Require manual or multi-sig approval before allowing the action. Kernel will block until ratification.

---

## Integration points & flows

### 1) API request gating (synchronous)
- Kernel forwards mutations (division updates, allocation requests, sign requests) to SentinelNet as a synchronous policy check with a `requestId`.  
- SentinelNet evaluates policies within a bounded time budget (low-latency path).  
- It returns `decision, policyId, rationale, confidence`. Kernel honors decision (deny/quarantine/allow).  
- SentinelNet emits `policyCheck` audit event linking to request/audit details.

### 2) Audit event consumption (asynchronous)
- SentinelNet subscribes to the audit bus and retroactively evaluates policies on streams of events (safety scanning, anomaly detection).  
- It can flag systems or generate remediation actions based on historical patterns (e.g., sudden spike in agent failures indicating exploit).

### 3) Resource allocation & runtime enforcement
- Resource Allocator must call SentinelNet pre-apply. SentinelNet can block allocations that exceed budget, violate quotas, or trigger safety rules.  
- SentinelNet monitors runtime signals (heartbeats, telemetry) via streaming inputs and can dynamically quarantine agents or reduce allocations.

### 4) Agent & network controls
- SentinelNet can push enforcement commands to Agent Manager or infra (via Kernel) to apply network policies, block egress, isolate pods, or revoke keys.  
- Enforcement actions are executed by the target service and must return results; SentinelNet records outcomes.

---

## Observability & explainability
- Every decision contains a clear textual rationale and a structured `evidence` array pointing to metrics, audit events, and traces.  
- Decisions include confidence and severity.  
- Provide an explain endpoint for CommandPad: `GET /sentinel/explain/{policyCheckId}` returns the full evidence and the logical rule path that fired.  
- Provide policy simulation UI and batch impact reports.

---

## Policy authoring & lifecycle
- Policy Registry with versioning, testing, and rollouts: draft → test (simulate) → canary → active → deprecated.  
- Policies must include tests (unit / scenario inputs) that can be run in CI to validate behavior.  
- Changes to high-severity policies require multi-sig approval before activation (follow multisig-workflow).  
- Provide rollback of policy versions and audit trail of who changed what.

---

## Security & performance constraints
- SentinelNet must be highly available and low-latency for synchronous checks (p95 well under Kernel SLO for API flows).  
- Provide caching for recent policy decisions and pre-computed rule indexes to speed checks.  
- Policy evaluation must be safe: prevent runaway execution (bounded timeouts, safe evaluation engine).  
- mTLS for Kernel ↔ SentinelNet; RBAC for policy editing and overrides.  
- All enforcement actions and changes must be auditable and signed where appropriate.

---

## Simulation, testing & verification
- **Simulator**: run policy scenarios over historical audit data to estimate false-positive rates and impact.  
- **Dry-run**: run policies in `simMode` for a period and produce impact reports.  
- **Canary enforcement**: allow policies to be enforced for a subset of divisions/agents before global rollout.  
- **Fuzz & adversarial tests**: stress test policies with malformed inputs and simulated attack patterns.

---

## Remediation actions & safety hooks
- Define a small, controlled set of remediation actions that SentinelNet may trigger automatically. Each action must be:
  - Pre-approved and signed in policy metadata.  
  - Idempotent and reversible where possible.  
  - Logged as a separate AuditEvent with full evidence.
- Examples: revoke signer key, reduce CPU/GPU allocation by X, block egress to IP set, pause agent scheduling, create incident ticket, notify approvers.

---

## Human-in-the-loop & overrides
- CommandPad can display queued policy decisions that require manual approval or multi-sig ratification.  
- Overrides: human overrides must be recorded as signed audit events and may be time-limited (expire).  
- Override policy: only specific roles (SuperAdmin, SecurityEngineer) may ratify critical blocks; all overrides are auditable.

---

## Metrics & monitoring
- Key metrics: check latency, decision distribution (allow/deny/quarantine), false positive rate (via simulation), remediation success rate, number of escalations, policy deployment failures.  
- Alerts: high denial rate, high remediation failure rate, policy engine errors, abnormal spikes in policy firings.  
- Tracing: span for each policy evaluation showing rule evaluation path and evidence fetch.

---

## Storage & retention
- Policy registry stored in Postgres with versioning; policy checks stored in audit bus and durable sink (S3) for long-term retention and audits.  
- PolicyCheck records retained per audit policy (e.g., 7+ years for finance/governance-related events).  
- Evidence pointers stored (audit ids, metric snapshots) rather than duplicating large payloads unless necessary for forensics.

---

## Acceptance criteria (minimal)
- **Policy registry**: create/update/list policies with versioning and status.  
- **Sync checks**: Kernel can call SentinelNet synchronously and receive decisions within SLO; decisions honored by Kernel.  
- **Audit events**: SentinelNet emits `policyCheck` events for every decision with rationale and evidence.  
- **Remediation**: SentinelNet can trigger a sample remediation action (e.g., mark allocation `quarantined`) and record outcome.  
- **Simulation**: run policy in `simMode` over recent audit data and produce an impact report.  
- **Security**: mTLS + RBAC enforced; policy edits require appropriate roles and high-severity changes require multi-sig.  
- **Explainability**: `GET /sentinel/explain/{policyCheckId}` returns structured rationale and evidence.  
- **Integration tests**: SentinelNet blocks a policy-violating allocation, quarantines a runtime agent based on telemetry, and records all actions as audit events.  
- **Performance**: synchronous checks respond within Kernel SLO for API calls (p95 target, to be defined based on Kernel SLO).

---

## Example policies (short)
1. **Budget cap** — deny allocations that would put division over budget.  
2. **High churn** — quarantine agent spawns when spawn rate for a user > N/min.  
3. **PII leakage** — deny manifest that contains detected PII unless ratified by multi-sig.  
4. **Signer age** — deny signature use if signer key older than rotation window or revoked.  
5. **Agent misbehavior** — quarantine agent if error rate > threshold AND suspicious outbound traffic detected.

---

End of spec.

