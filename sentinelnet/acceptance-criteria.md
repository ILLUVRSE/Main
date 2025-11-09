# SentinelNet — Acceptance Criteria

SentinelNet must be a low-latency policy engine with explainability and auditable actions.

## # 1) Synchronous checks
- Kernel pre-checks succeed within SLO (p95 latency target configured).
- Decision correctness validated with synthetic test cases.

## # 2) Policy registry and lifecycle
- Create/modify policy → simulation/dry-run → canary → full activation.
- Multisig gating for high-severity policies.

## # 3) Events & explainability
- Every decision emits `policyCheck` with rationale and pointers to evidence (audit ids, metrics).
- Explain endpoint returns decision rationale and evidence.

## # 4) Simulation & canary
- Simulation mode produces impact reports, false-positive rate measured.
- Canary rollout with rollback measured & tested.

## # 5) Security
- mTLS for Kernel ↔ SentinelNet; policy edits require RBAC & audit trail.

## # Verification
- Integration tests for synchronous check, event emission, explain endpoint, and canary behavior.

