# SentinelNet — API Documentation (initial)

This document describes the earliest, stable API surfaces for SentinelNet: synchronous checks, policy lifecycle, and explainability. Endpoints are mounted under `/sentinelnet/*` by default.

All endpoints that modify policy state MUST be protected by RBAC and authenticated. Kernel ↔ SentinelNet communication MUST use mTLS in production.

---

## Common response shape conventions

* Successful responses return `2xx` and JSON objects.
* Error responses follow `{ error: "<code>", message?: "<human text>", ... }`.
* `policy` objects use the Policy model as persisted in Postgres: `{ id, name, version, severity, rule, metadata, state, createdBy, createdAt, updatedAt }`.

---

## 1) POST /sentinelnet/check

**Purpose:** Synchronous pre-action check used by Kernel or other services to determine whether an action is allowed.

**Request**

```
POST /sentinelnet/check
Content-Type: application/json
Authorization: Bearer <token>
Body:
{
  "action": "kernel.agent.spawn",
  "actor": { "id": "user-123", "type":"human", "roles":["operator"] },
  "resource": { "type": "agent", "id": "agent-xyz" },
  "context": { "manifest": { "id": "manifest-1" }, "extra": "data" }
}
```

**Response (200) — allowed example**

```json
{
  "decision": "allow",
  "allowed": true,
  "ts": "2025-01-10T12:00:10Z"
}
```

**Response (200) — denied example**

```json
{
  "decision": "deny",
  "allowed": false,
  "policyId": "policy-3f2a",
  "policyVersion": 2,
  "ruleId": "rule-7",
  "rationale": "High-severity policy matched: reason...",
  "evidence_refs": ["audit:aud-123"],
  "ts": "2025-01-10T12:00:10Z"
}
```

**Response (403) — structured policy denial**

```json
{
  "error": "policy.denied",
  "decision": { "decision": "deny", "allowed": false }
}
```

**Notes**

* Endpoint must return quickly; aim for p95 < 50ms.
* If Kernel requires a signed audit item, SentinelNet attempts to append one before returning; failures do not block the decision.

---

## 2) POST /sentinelnet/policy

**Purpose:** Create or update a policy and optionally run simulation.

**Request**

```
POST /sentinelnet/policy
Content-Type: application/json
Authorization: Bearer <token>
Body:
{
  "id": "policy-uuid (optional)",
  "name": "block-large-alloc",
  "severity": "HIGH",
  "rule": { },
  "metadata": {
    "effect": "deny",
    "ruleId": "rule-01",
    "canaryPercent": 5
  },
  "simulate": true
}
```

**Response (201)**

```json
{
  "policy": {},
  "simulation": {}
}
```

**Notes**

* Simulation is optional.
* Updates may create new versions depending on server logic.
* High-severity activations require multisig.

---

## 3) GET /sentinelnet/policy/:id/explain

**Purpose:** Return explanation and recent decisions for a policy.

**Response**

```json
{
  "policy": {},
  "history": [],
  "recentDecisions": [],
  "note": "If Kernel audit search not configured, recentDecisions may be empty"
}
```

**Notes**

* `recentDecisions` fetched best-effort from Kernel.
* `history` from local DB.

---

## 4) Event subscription / async detection

**Purpose:** Asynchronous detection by consuming audit events.

### Options

1. **Streaming (production):** Kafka/Redpanda consumer.
2. **Polling (dev / fallback):** Uses search-based polling.

### Handler contract

* For each audit event, evaluate policies.
* Emit `policy.decision` audit events.

---

## 5) Audit / policy.decision

**Purpose:** How SentinelNet records decisions.

```json
{
  "policy": "<policyId>",
  "decision": {
    "id": "<decision-id>",
    "decision": "deny",
    "allowed": false,
    "policyVersion": 2,
    "ruleId": "rule-7",
    "rationale": "explain text ...",
    "evidenceRefs": ["audit:<id>", "metrics:..."],
    "ts": "2025-01-10T12:00:10Z"
  },
  "principal": { "id": "...", "type": "...", "roles": ["..."] },
  "context": { "action": "...", "resource": {}, "sampleContext": {} }
}
```

**Notes**

* Kernel prefers being canonical signer.
* Events must be signed and chained.

---

## 6) Error codes & status mapping

* `400` invalid request
* `401` unauthenticated
* `403` forbidden or policy-denied structured response
* `404` not found
* `409` conflict
* `500` server error

---

## 7) Security / auth

* Kernel ↔ SentinelNet requires mTLS.
* Human/admin UI uses OIDC/SSO with RBAC.
* High-severity activation uses Kernel multisig.

---

## 8) Examples & quick curl

**Check**

```bash
curl -X POST http://localhost:7602/sentinelnet/check \
  -H "Content-Type: application/json" \
  -d '{"action":"kernel.agent.spawn","actor":{"id":"user-1"}}'
```

**Create policy**

```bash
curl -X POST http://localhost:7602/sentinelnet/policy \
  -H "Content-Type: application/json" \
  -d '{"name":"block-large-alloc","severity":"HIGH","rule":{},"metadata":{"effect":"deny"},"simulate":true}'
```

---

## Versioning & backward compatibility

* API is v1; breaking changes require versioning.

---

