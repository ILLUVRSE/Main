# SentinelNet — Core Module

## # Purpose
SentinelNet is the real-time policy and enforcement engine for ILLUVRSE. It evaluates policy checks on API calls, audit events, allocations, model/dataset actions, and agent behavior; decides allow/deny/quarantine/remediate; and emits auditable `policyCheck` events. It must provide explainability for decisions and integrate tightly with Kernel, Agent Manager, AI Infra, and Marketplace.

## # Location
All files for SentinelNet live under:
`~/ILLUVRSE/Main/sentinelnet/`

## # Files in this module
- `sentinelnet-spec.md` — core policy & enforcement specification (already present).  
- `README.md` — this file.  
- `deployment.md` — deployment & infra guidance (to be created).  
- `api.md` — API surface and examples (to be created).  
- `acceptance-criteria.md` — testable checks for SentinelNet (to be created).

## # How to use this module
1. Read `sentinelnet-spec.md` to understand the policy language, enforcement modes, and remediations.  
2. Implement SentinelNet as a low-latency service that:
   * Accepts synchronous Kernel/Agent Manager pre-action checks (mTLS).  
   * Subscribes to the Event Bus / audit stream for asynchronous detection.  
   * Returns structured `policyCheck` audit events including rationale and evidence pointers.  
   * Exposes an explain endpoint that ties decisions to audit ids, metrics snapshots, and sample artifacts.  
3. Provide policy lifecycle tools: versioning, simulation/dry-run, canary rollouts, and multisig gating for high-severity policy changes.

## # Security & governance
- Use **mTLS** for Kernel ↔ SentinelNet and strict RBAC for policy edits.  
- High-severity policy activations require multisig approval and must be auditable.  
- All enforcement actions and overrides are signed and recorded as audit events.

## # Observability & performance
- Provide metrics: check latency (p50/p95/p99), decision distribution, remediation success rate, false-positive rate in simulation.  
- Synchronous checks must meet Kernel SLOs (p95 target to be defined in Kernel integration).

## # Acceptance & sign-off
SentinelNet is accepted when:
* Synchronous Kernel checks operate within SLO and are correct in tests.  
* `policyCheck` events emitted for each decision with verifiable evidence.  
* Simulation & canary modes function and provide impact reports.  
* Remediation actions execute and are auditable.

Final approver: **Ryan (SuperAdmin)**. Security Engineer must review policy lifecycle and multisig workflows.

## # Next single step
Create `deployment.md` for SentinelNet (one file) describing high-availability topology, mTLS certificates, policy registry backup, and rollout strategy. When ready, reply **“next-sentinelnet”** and I’ll produce the file.

