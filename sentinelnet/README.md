# SentinelNet — Core Module

## # Purpose
SentinelNet is the real-time policy and enforcement engine for ILLUVRSE. It evaluates policies on API calls, audit events, allocations, model/dataset actions, and agent behavior; decides allow/deny/quarantine/remediate; and emits auditable `policyCheck` events. It enforces governance automatically and provides explainability for decisions.

## # Location
All files for SentinelNet live under:

~/ILLUVRSE/Main/sentinelnet/

## # Files in this module
- `sentinelnet-spec.md` — core policy & enforcement specification (already present).
- `README.md` — this file.
- `deployment.md` — deployment & infra guidance (to be created).
- `api.md` — API surface and examples (to be created).
- `acceptance-criteria.md` — testable checks for SentinelNet (to be created).
- `.gitignore` — local ignores for runtime files (to be created).

## # How to use this module
1. Read `sentinelnet-spec.md` to understand the policy language, enforcement modes, remediations, and integration points.
2. Implement SentinelNet as a low-latency policy service that Kernel can call synchronously for pre-action checks and that subscribes to the audit/event stream for asynchronous detection.
3. Provide a policy registry with versioning, simulation (dry-run), canary rollout, and multi-sig gating for high-severity policies.
4. Ensure every decision produces a `policyCheck` audit event with rationale and evidence; provide an explain endpoint for CommandPad and auditors.

## # Security & governance
- Use mTLS for Kernel ↔ SentinelNet and strict RBAC for policy edits and overrides.
- High-severity policy activations require multisig approval.
- All enforcement actions and overrides are signed and recorded as audit events.
- SentinelNet must operate under least privilege and be auditable end-to-end.

## # Observability & performance
- Provide metrics: check latency (p50/p95/p99), decision distribution, remediation success rate, and simulation false-positive rates.
- Decisions must be explainable: include evidence pointers (audit ids, metrics snapshots) and a textual rationale.
- Synchronous checks must meet Kernel SLO (p95 target defined during Kernel integration).

## # Acceptance & sign-off
SentinelNet is accepted when:
- It responds to synchronous Kernel checks within SLO and returns correct decisions in tests.
- `policyCheck` events are emitted for every decision, with verifiable rationale and evidence.
- Simulation and canary modes are functional and provide impact reports.
- Remediation actions execute and are auditable.
Final approver: **Ryan (SuperAdmin)**. Security Engineer must review policy lifecycle and remediation safety.

## # Next single step
Create `deployment.md` for SentinelNet (one file). When you’re ready, reply **“next”** and I’ll provide the exact content for that single file.

---

End of README.

