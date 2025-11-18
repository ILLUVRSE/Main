# SentinelNet — API & Contract

**Base URLs (examples)**

* Local dev: `http://localhost:7602`
* Prod: `https://sentinelnet.{env}.illuvrse.internal`

**Security**

* Service-to-service: **mTLS** preferred (production). Kernel must be able to call SentinelNet over mTLS.
* Human/operator: **OIDC** (SSO). Map claims → roles (e.g., `sentinel-admin`, `policy-approver`).
* Admin endpoints require additional hardened auth (multisig or strict RBAC).

**Global headers**

* `X-Request-Id` — string (UUID) for tracing
* `Idempotency-Key` — string for deduplication of write flows
* `Authorization` — `Bearer <OIDC token>` for human flows; mTLS client certs for service flows

**Error envelope**

```json
{
  "ok": false,
  "error": {
    "code": "POLICY_DENIED",
    "message": "Human-readable explanation",
    "details": { /* optional structured info */ }
  }
}
```

**Success envelope**
Most success responses:

```json
{ "ok": true, ... }
```

---

## Core endpoints

### 1) `POST /sentinelnet/check` — synchronous policy check (blocking)

**Purpose:** Evaluate a policy (or policy set) against an action envelope and return a decision (`allow|deny|quarantine`) and rationale. Intended for low-latency, pre-action policy gating (e.g., allocation, promotion).

**Security:** Kernel ↔ SentinelNet (mTLS) or Kernel-proxied. Human/operator flows may call for simulation only.

**Request (JSON):**

```json
{
  "request_id": "req-123",
  "action": "allocation.request",
  "actor": "service:eval-engine",
  "resource": {
    "entity_id": "agent-1",
    "cpu": 4,
    "gpu": 1,
    "memoryMB": 8192,
    "target_env": "production"
  },
  "context": {
    "manifest_signature_id": "manifest-sig-abc",
    "promotion_id": "promo-42",
    "metrics": { "score": 0.93, "delta": 0.025 }
  },
  "simulate": false,
  "canary": { "enabled": true, "sampleSize": 1000, "samplePercent": 5 }
}
```

**Response (200):**

```json
{
  "ok": true,
  "decision": "allow",           // allow | deny | quarantine
  "reason": "policy:budget_limit_passed",
  "rationale": [
    { "rule": "budget_check", "result": "pass", "explanation": "budget available" },
    { "rule": "safety_check", "result": "pass" }
  ],
  "policy_id": "policy-123",
  "policy_version": "v3",
  "is_canary_sampled": false,
  "ts": "2025-11-18T12:00:00Z"
}
```

**Notes / semantics**

* `simulate=true` returns the decision and a `simulation_report` but must **not** block or change state.
* `canary` field enables deterministic sampling (seeded by `request_id`) so a fixed percent of requests are used for canary evaluation.
* All checks must emit a `policy.decision` AuditEvent with `policyId`, `policyVersion`, `decision`, `rationale`, `requestId`, `actor`, and `signature` metadata (signed or Kernel-anchored).
* Latency target: p95 < 50ms (prod). For dev `p95 < 200ms`.

---

### 2) `POST /sentinelnet/policy` — create a policy (or new version)

**Purpose:** Create or version a policy. Supports `simulate=true` and `dryRun` to preview impact.

**Security:** Authenticated `sentinel-admin` role or Kernel multisig flow for high-severity policies.

**Request (JSON):**

```json
{
  "policy_id": "policy-123",              // optional: server may assign
  "name": "BudgetLimit",
  "severity": "MEDIUM",                   // LOW | MEDIUM | HIGH | CRITICAL
  "rule": { "lang": "jsonlogic", "expr": { ">" : [ { "var": "context.metrics.score" }, 0.9 ] } },
  "metadata": { "owner": "security", "canaryPercent": 0 },
  "simulate": false,
  "version_from": null
}
```

**Response:**

* `201` — created:

```json
{ "ok": true, "policy_id": "policy-123", "version": "v1" }
```

**Notes**

* For `severity` HIGH/CRITICAL, the API may require a multisig activation workflow (see “policy activation + multisig” below). In that case, policy creation returns `202` with `status: pending_multisig` and an `upgrade_manifest_id` to be ratified via Kernel multisig.
* Policy rule languages supported: JSONLogic, CEL (future), or domain DSL. MUST include `simulate` support.

---

### 3) `GET /sentinelnet/policy/{id}` — fetch policy

**Response:** returns latest version details, history, last simulation metrics, and active canary state.

---

### 4) `POST /sentinelnet/policy/{id}/simulate` — run simulation

**Purpose:** Apply a policy to a sample set (or provided `sampleEvents`) and return an impact report.

**Request:**

```json
{
  "policy_id": "policy-123",
  "sampleEvents": [ { /* audit event or sample payload */ } ],
  "sampleSize": 1000,
  "verbose": true
}
```

**Response:**

* `200` — simulation report with `deny_rate`, `quarantine_rate`, `examples`, `estimated_impact_by_entity` etc.

**Notes**

* Must support both local/offline simulation and a server-side `simulate=true` that can be a dry-run in production to measure impact.

---

### 5) Multisig activation flow (policy lifecycle)

**When to use:** Activating a `HIGH` or `CRITICAL` policy that affects production safety/security.

**High-level steps:**

1. Operator calls `POST /sentinelnet/policy` with `request_multisig=true` or calls `multisigGating.createPolicyActivationUpgrade` (helper). The service returns an `upgrade_manifest` and `upgrade_id`.
2. Kernel/Control-Panel submits the manifest for multi-approver collection (3-of-5). Approvals produce signed Approval Records recorded by Kernel.
3. Once quorum collected, Kernel calls SentinelNet to mark policy as `active` referencing the `AppliedUpgradeRecord`.
4. SentinelNet confirms activation, runs a final apply verification, and emits `policy.activated` AuditEvent.

**API hooks / endpoints**

* `POST /sentinelnet/multisig/upgrade` — create upgrade manifest (internal)
* `GET /sentinelnet/multisig/{upgrade_id}` — status
* `POST /sentinelnet/multisig/{upgrade_id}/apply` — apply once Kernel reports quorum (internal)

**Requirements**

* All upgrade artifacts must be canonicalized, hashed, and signed per Kernel audit spec.
* Emergency activation (via SuperAdmin) must be supported with post-hoc ratification window (e.g., 48h). Emergency events are recorded and labeled.

---

### 6) `GET /sentinelnet/metrics` and `GET /sentinelnet/health`

* **Metrics** required:

  * `sentinel_check_latency_seconds` (histogram)
  * `sentinel_decisions_total` (counter, labels: decision, policy_id, severity)
  * `sentinel_canary_percent` (gauge)
  * `sentinel_simulation_impact_denied_total`
* **Health / readiness**: DB, policy store, Kafka consumer (if used), Kernel connectivity, signer/KMS availability.

---

## Audit obligations

* Every `POST /sentinelnet/check` decision (even when returned as simulation) should result in a `policy.decision` AuditEvent with:

  * `eventType`: `policy.decision`
  * `payload`: `{ request_id, decision, reason, policy_id, policy_version, rationale, actor, trace }`
  * `prevHash`, `hash`, `signature`, `signerId`, `ts`
* Policy changes (`policy.create`, `policy.update`, `policy.version`, `policy.activated`) must emit audit events describing the change, `proposedBy`, and any multisig metadata.

---

## Canary semantics

* Canary decisions must be deterministic and seeded by `request_id` so the same request deterministically falls into same sampled fate.
* Canary mode should support a `samplePercent` and `sampleSize` so canary coverage is predictable.
* Canary auto-rollback: when denial rate exceeds a configured threshold, SentinelNet must emit a high-priority alert and optionally initiate canary rollback (depending on policy settings).

---

## PII & redaction

* If a policy decision includes PII in the rationale or evidence, the response must redact it for callers without `read:pii` capability. Provide `explain` strings and `evidence_refs` to audit events for privileged consumers.

---

## Acceptance tests (must exist)

* Unit tests for JSONLogic/CEL rule engine behaviors and edge cases.
* Integration tests:

  * `POST /sentinelnet/check` returns expected allow/deny for crafted payloads.
  * `simulate=true` returns simulation report and does not change state.
  * Canary sampling deterministic by `request_id`.
  * Multisig activation flow: create policy requiring multisig → collect simulated approvals → apply → policy active.
* Audit tests: verify that `policy.decision` audit events are emitted and verifiable via canonicalization + signature verification tooling.

---

## Operational notes

* Policy store must support versioning and rollback.
* Provide admin UI (Control-Panel integration) to create/simulate policies and view canary metrics.
* Provide `sentinelnet/runbooks/multisig.md`, `sentinelnet/runbooks/canary.md`, and `sentinelnet/runbooks/policy-revision.md`.

---

## Example CLI checks (reviewer)

```bash
# Run local check
curl -X POST http://localhost:7602/sentinelnet/check \
  -H "Content-Type: application/json" \
  -d '{"request_id":"r1","action":"allocation.request","actor":"service:eval-engine","resource":{"entity_id":"agent-1","cpu":4}}'

# Create policy (simulate)
curl -X POST http://localhost:7602/sentinelnet/policy \
  -H "Content-Type: application/json" \
  -d '{"name":"TestPolicy","severity":"LOW","rule":{"lang":"jsonlogic","expr":{"==":[{"var":"context.metrics.test"},true]}},"simulate":true}'
```

---

## Signoffs

* Required: `sentinelnet/signoffs/security_engineer.sig` and `sentinelnet/signoffs/ryan.sig` before final acceptance.

---

