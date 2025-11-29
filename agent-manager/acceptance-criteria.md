# Agent Manager Acceptance Criteria

## 1. Spawn / lifecycle ACCEPTANCE
- **One-line acceptance**: POST /api/v1/agent/spawn returns agent_id and lifecycle APIs are idempotent and return correct codes.
- **Evidence**: `agent-manager/test/integration.test.js` exercises start/stop/restart/scale flows.
- **Commands**: `npm --prefix agent-manager run test`

## 2. Manifest enforcement ACCEPTANCE
- **One-line acceptance**: Agent Manager rejects unsigned/invalid manifests with 403 and accepts Kernel-signed manifests.
- **Evidence**: `agent-manager/scripts/test-manifest-enforce.sh` simulates acceptance & rejection.
- **Commands**: `./agent-manager/scripts/test-manifest-enforce.sh`

## 3. Sandbox runner ACCEPTANCE
- **One-line acceptance**: Sandbox run API executes tasks in isolation, returns passed|failed|timeout, emits audit events and logs for auditing.
- **Evidence**: `agent-manager/test/sandbox.test.js` validates isolation and outcomes.
- **Commands**: `npm --prefix agent-manager run sandbox-test`

## 4. Telemetry & audit ACCEPTANCE
- **One-line acceptance**: Agent Manager emits telemetry metrics and AuditEvents for spawn/start/stop/scale visible to Eval Engine.
- **Evidence**: `metrics/` implementation and `tools/check_telemetry.py`.
- **Commands**: `python3 tools/check_telemetry.py`

## 5. Security review & sign-off ACCEPTANCE
- **One-line acceptance**: Security review documented and signed.
- **Evidence**: `agent-manager/security-review.txt` and `agent-manager/signoffs/ryan.sig` exist.
- **Commands**: `test -f agent-manager/security-review.txt && test -f agent-manager/signoffs/ryan.sig`
