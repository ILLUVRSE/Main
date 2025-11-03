# SentinelNet — Acceptance Criteria

Purpose: short, verifiable checks proving SentinelNet is correct, low-latency, auditable, safe to operate, and production-ready. Each item is actionable and testable.

---

## # 1) Synchronous check SLOs & correctness
- **Latency:** synchronous policy checks complete within the Kernel SLO (p95 target e.g., <150ms).
- **Correctness:** sample policies produce expected allow/deny/quarantine outcomes for a curated set of test cases.

**How to verify:** Run a load test of synchronous checks with representative payloads; assert p95 latency and correctness for test vectors.

---

## # 2) Audit events & evidence
- **PolicyCheck events emitted:** every synchronous and asynchronous decision produces a `policyCheck` audit event including `policyId`, `decision`, `rationale`, `confidence`, and evidence pointers.
- **Verifiability:** `policyCheck` events are present in the audit sink and pass hash/signature verification per the Audit Log Spec.

**How to verify:** Trigger policy checks and validate corresponding audit events exist and verify signature/hash integrity.

---

## # 3) Simulation & canary rollout
- **Sim mode:** policies can run in `simMode` and produce impact reports (FP/FN estimates) without enforcement.
- **Canary:** canary rollout applies a policy to a configurable subset (division or % traffic) and collects metrics before full activation.

**How to verify:** Run policies in simulation over historical data and validate impact report. Perform canary activation and confirm metrics collection and canary rollback behavior.

---

## # 4) Remediation execution & safety
- **Remediation works:** remediation actions (pre-approved set) can be executed and return successful outcomes; failures are recorded and alert.
- **Idempotency & reversibility:** remediation actions are idempotent where possible and reversible or logged for manual recovery.

**How to verify:** Execute a sample remediation (e.g., mark allocation `quarantined` or isolate an agent) and confirm the action executes, result recorded, and audit event emitted.

---

## # 5) Explainability & evidence API
- **Explain endpoint:** `GET /sentinel/explain/{policyCheckId}` returns structured rationale, rule path, confidence, and evidence pointers.
- **Evidence size & pointers:** evidence is pointer-based (audit ids/metric snapshots) and not unbounded payloads.

**How to verify:** Invoke explain endpoint for recent policy checks and inspect returned structure and pointers; verify referenced evidence exists.

---

## # 6) Asynchronous detection & streaming
- **Streaming evals:** workers process audit/event stream and raise `policyCheck` events for retrospective anomalies or patterns (e.g., rate spikes).
- **DLQ & retries:** failed evaluations go to DLQ with retry/backoff and operator visibility.

**How to verify:** Feed historical audit events and confirm SentinelNet flags expected anomalies; simulate worker failure and verify DLQ behavior.

---

## # 7) Policy lifecycle & governance
- **Registry operations:** create/update/list policy with versioning and status (`draft|sim|canary|active`).
- **Tests & CI:** each policy includes unit/scenario tests that run in CI.
- **Multisig gating:** activation of `critical` policies requires multisig approval as defined in multisig-workflow.

**How to verify:** Create policy with tests, run CI simulation, attempt to activate a critical policy without multisig (should be blocked), then apply multisig approvals and confirm activation.

---

## # 8) Security & access control
- **mTLS & RBAC:** Kernel-only synchronous calls succeed; unauthorized callers rejected. Policy edits restricted per RBAC; admin UI protected by OIDC/SSO + 2FA.
- **Signing & key usage:** any signed policy activation or critical decision uses KMS/HSM via signing proxy; private keys never exposed.

**How to verify:** Test mTLS enforcement for API, attempt unauthorized edits and confirm rejection, and validate signing flows use KMS.

---

## # 9) Explainable false-positive control
- **False-positive monitoring:** simulation and canary metrics reported; alerts created when FP rate exceeds configured threshold.
- **Rollback & tuning:** policies can be rolled back quickly from canary or simulation results.

**How to verify:** Run a test policy that intentionally causes FP in canary and confirm FP metrics trigger alert and operator can rollback.

---

## # 10) Observability & alerts
- **Metrics present:** check latency, decision distribution, remediation success, simulation FP/FN rates, worker backlog.
- **Tracing:** end-to-end trace for sync checks including rule evaluation spans.
- **Alerts:** high denial rate, high remediation failure rate, policy deploy failures, slow sync checks, worker lag.

**How to verify:** Validate metrics on dashboards and simulate an alert condition for each key alert.

---

## # 11) Backups & replayability
- **Policy registry backups:** regular Postgres backups and PITR; test restore.
- **Replayability:** ability to re-run policies over archived audit events to validate behavior after fixes.

**How to verify:** Restore policy registry from backup and re-run a simulation over archived audit events.

---

## # 12) Tests & automation
- **Unit tests:** rule evaluation, canonicalization, timeout/fallback behavior.
- **Integration tests:** end-to-end Kernel → SentinelNet → Kernel for sync checks, explainability, and remediation execution.
- **Chaos tests:** simulate timeouts, high load, and KMS unavailability to validate safe fallbacks (e.g., deny/escalate) and alerting.

**How to verify:** Run CI and chaos tests in staging and confirm pass and safe behavior.

---

## # 13) Documentation & sign-off
- **Docs present:** `sentinelnet-spec.md`, `deployment.md`, `README.md`, and this acceptance file exist and are up-to-date.
- **Sign-off:** Security Engineer and Ryan must sign off on policies, remediation set, and multisig configuration. Record sign-off as an AuditEvent.

**How to verify:** Confirm files present and obtain written sign-off recorded in audit bus.

---

## # Final acceptance statement
SentinelNet is accepted when all above criteria pass in a staging environment, synchronous checks meet SLOs, simulations/canaries validate policy behavior, remediation actions are safe and auditable, and formal sign-off by Security Engineer and Ryan is recorded.

