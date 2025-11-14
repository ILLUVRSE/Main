# SentinelNet — Acceptance Criteria (first tranche)

This file converts the high-level acceptance paragraphs into concrete, testable criteria for the initial implementation. The goal is to provide a minimal, verifiable surface so we can iterate quickly and sign off incrementally.

---

## 1) Synchronous checks (API correctness & SLO)
**Acceptance**
- `POST /sentinelnet/check` accepts `{ action, actor?, resource?, context? }` and returns a decision envelope (allow|deny|quarantine|remediate) with `ts`. (Functional test)
- Tests:
  - Unit/integration test that a request with `action` missing returns `400`. (`test/check.test.ts`)  
  - Integration test: when an active policy matches, the endpoint returns `deny` with `policyId` and `rationale`. (Add an integration test which inserts an active policy and posts a sample action.)
- Performance (SLO, best-effort for first cut):
  - Measure p95 latency in local load test; aim < 200ms initially for dev. Production SLO (p95 < 50ms) is a target for later iterations (documented in `deployment.md`).

---

## 2) Policy registry & lifecycle
**Acceptance**
- `POST /sentinelnet/policy` creates a policy row in Postgres with `id, name, version, severity, rule, metadata, state, createdAt`. (`sql/migrations/001_create_policies.sql` + `policyStore.createPolicy`)  
- `GET /sentinelnet/policy/:id/explain` returns `policy`, recent `policy_history` rows, and (best-effort) `recentDecisions`. (`explainService`)  
- Versioning:
  - Creating a new version must increment `version` and record a `policy_history` entry. (`policyStore.createPolicyNewVersion` + tests)
- Tests:
  - Unit tests for create/read/list/update flows (`test/policyStore.test.ts`).
  - Integration: create a policy with `simulate=true` and receive a simulation report.

---

## 3) Events & explainability
**Acceptance**
- Every decision emitted by SentinelNet results in a `policy.decision` audit event submitted to Kernel audit endpoint. The event payload includes `policyId`, `policyVersion`, `rationale`, `evidenceRefs`, and `ts`. (`auditWriter.appendPolicyDecision`)  
- `GET /sentinelnet/policy/:id/explain` returns pointer(s) to recent decisions (`recentDecisions`) and a human-readable rationale. (`explainService`)  
- Tests:
  - Unit test verifies that `auditWriter.appendPolicyDecision()` attempts to post to Kernel and returns an id when Kernel returns an `id`.  
  - Integration test: evaluate a matched policy and assert that `policy.decision` has been appended (for local testing the Kernel mock should respond with an event including `id`).

---

## 4) Simulation & canary
**Acceptance**
- Simulation:
  - `POST /sentinelnet/policy` supporting `simulate=true` returns an impact report: `sampleSize`, `matched`, `matchRate`, and `examples`. (`simulator.runSimulation`)  
  - Unit tests validate match rate and example selection from provided `sampleEvents`. (`test/simulator.test.ts`)
- Canary:
  - Policy may be placed into `canary` state and configured with `canaryPercent` (policy.metadata.canaryPercent). Deterministic sampling based on `requestId` is used. (`canary.shouldApplyCanary`)  
  - Tests: unit tests for `shouldApplyCanary()` determinism and boundaries.

---

## 5) Multisig gating (policy activation)
**Acceptance**
- For `severity=HIGH|CRITICAL`, an activation to `active` must be gated by Kernel's multisig flow:
  - SentinelNet must be able to create a `policy_activation` manifest via Kernel (`multisigGating.createPolicyActivationUpgrade`).  
  - End-to-end test (integration) that creates an upgrade manifest and that Kernel accepts it (use Kernel mock or test double); full multisig e2e with real Kernel is addressed in later integration stages.
- Tests:
  - Unit tests that `multisigGating` constructs an upgrade payload and handles Kernel responses for create/approve/apply.

---

## 6) Security & transport
**Acceptance**
- mTLS is required for Kernel ↔ SentinelNet in production. For development `DEV_SKIP_MTLS=true` may be used. (`deployment.md` & `config/env.ts`)  
- Policy edits require RBAC in production; first cut assumes an authenticated principal (placeholder). Add RBAC gating before production rollout.
- Tests:
  - Health/readiness should indicate whether mTLS or Kernel endpoint is configured; no automated test required in dev.

---

## 7) Async detection & event subscription
**Acceptance**
- A working prototype consumer that reads Kernel audit events and invokes policy evaluation exists (`event/consumer.ts` + `event/handler.ts`). For dev this can be polling `/kernel/audit/search`.  
- Tests:
  - A smoke test that uses the Kernel mock to return a set of audit events and verifies `handleAuditEvent()` emits `policy.decision` events.

---

## 8) Observability & metrics
**Acceptance**
- Service exposes `/metrics` and registers at least:
  - `sentinel_check_latency_seconds` (Histogram)
  - `sentinel_decisions_total` (Counter)
  - `sentinel_canary_percent` (Gauge)
- Tests:
  - Unit test that metrics registry registers the named metrics (or a simple smoke check of `/metrics` returning text).

---

## 9) Verification
**Acceptance**
- Integration test suite that covers:
  - Synchronous check + audit append,
  - Policy create + simulate,
  - Event consumption → policy decision emission,
  - Canary sampling semantics,
  - Multisig gating flow (mocked Kernel).
- These tests must run in CI (or locally via `run-local.sh` with a Kernel mock).

---

## Notes & minimal sign-off
- The initial sign-off requires functional confirmation of the bullets above. Production readiness (strict p95 SLOs, KMS/HSM integration, Kafka consumer, RBAC, and full multisig end-to-end with Kernel) will be additional acceptance steps after this first tranche is validated.

End of acceptance criteria.

---

## Final acceptance checklist
- [x] `POST /sentinelnet/check` validates `action`, enforces policies, records metrics, and tests cover 400/error + deny flows.
- [x] Policy registry supports create, read, explain, history, simulation, and versioning semantics with tests.
- [x] Audit writer appends `policy.decision` envelopes (unit + integration coverage).
- [x] Simulation API and deterministic canary sampling implemented with unit tests.
- [x] Multisig gating helper produces/approves/applies `policy_activation` manifests (mocked Kernel flow covered).
- [x] mTLS/transport readiness surfaced in `/health`/`/ready`, dev/prod guidance updated in docs.
- [x] Async event consumer + handler exercise evaluation path and emit audit decisions (smoke tests).
- [x] `/metrics` exposes required histogram/counter/gauge (unit smoke check).
- [x] Integration suite spans synchronous check+audit, policy simulate, event consumption, canary semantics, and multisig gating; CI + `run-local.sh` wire these commands.

**Sign-off (first tranche):** Tests executed via `npm test --runInBand` (covers unit + integration suites listed above). Local verification of policy simulation, decision service, audit writer, canary logic, event consumer, and multisig gating completed on 2025-11-13 by Codex agent. Use `./run-local.sh` to reproduce with Kernel mock + migrations + Jest.
