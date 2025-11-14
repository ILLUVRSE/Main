# Eval Engine & Resource Allocator — API Reference

This document describes the minimal ingestion, promotion, and allocation APIs implemented in this repo. All endpoints are HTTP+JSON and expect Kernel-authenticated calls (mTLS in production; bearer token debug mode optional).

---

## Base URLs
- **Eval ingestion service:** `http://localhost:8051`
- **Resource Allocator service:** `http://localhost:8052`

Both addresses are configurable via `EVAL_ENGINE_ADDR` and `RESOURCE_ALLOCATOR_ADDR`.

---

## Shared conventions
- `Content-Type: application/json` required for POST bodies.
- `Idempotency-Key` header reserved for future use (no-op for now).
- Errors return `{ "error": "message" }` with appropriate HTTP status.

---

## Eval ingestion endpoints

### `POST /eval/submit`
Ingests an EvalReport, recomputes the agent score, and (if score ≥ threshold) creates a PromotionEvent and allocation request.

**Request**
```json
{
  "agentId": "agent-123",
  "metrics": { "successRate": 0.93, "latencyScore": 0.9 },
  "source": "agent-manager",
  "timestamp": "2025-01-17T18:00:00Z",
  "tags": { "window": "1h" }
}
```

**Response `200`**
```json
{
  "reportId": "b7f6a6f5-0e14-4b4c-bd9c-4b9bfdd58aec",
  "score": {
    "agentId": "agent-123",
    "score": 0.92,
    "confidence": 0.7,
    "components": {
      "components": [
        { "metric": "successRate", "value": 0.93 },
        { "metric": "latencyScore", "value": 0.9 }
      ]
    },
    "window": "1h",
    "computedAt": "2025-01-17T18:00:01Z"
  },
  "promotion": {
    "id": "e82f...",
    "agentId": "agent-123",
    "action": "promote",
    "status": "pending",
    "rationale": "score 0.92 >= threshold 0.85",
    "confidence": 0.7,
    "createdAt": "2025-01-17T18:00:01Z"
  }
}
```

### `GET /eval/agent/{id}/score`
Returns the latest computed score for an agent.

**Response `200`**
```json
{
  "agentId": "agent-123",
  "score": 0.92,
  "confidence": 0.7,
  "components": { "components": [...] },
  "window": "1h",
  "computedAt": "2025-01-17T18:00:01Z"
}
```

### `POST /eval/promote`
Creates a manual PromotionEvent and (optionally) triggers an allocation request.

**Request**
```json
{
  "agentId": "agent-123",
  "rationale": "manual override",
  "confidence": 0.9,
  "requestedBy": "ops",
  "pool": "gpus-us-east",
  "delta": 1
}
```

**Response `201`**
```json
{
  "id": "f25c...",
  "agentId": "agent-123",
  "action": "promote",
  "status": "pending",
  "rationale": "manual override",
  "confidence": 0.9,
  "requestedBy": "ops",
  "createdAt": "2025-01-17T18:10:00Z"
}
```

---

## Resource Allocator endpoints

### `POST /alloc/request`
Creates an allocation request (status `pending`).

**Request**
```json
{
  "promotionId": "f25c...",
  "agentId": "agent-123",
  "pool": "gpus-us-east",
  "delta": 1,
  "reason": "promotion threshold met",
  "requestedBy": "eval-engine"
}
```

**Response `201`**
```json
{ "requestId": "a8c7...", "status": "pending" }
```

### `POST /alloc/approve`
Runs SentinelNet policy checks and transitions a request to `applied` or `rejected`.

**Request**
```json
{
  "requestId": "a8c7...",
  "approvedBy": "allocator-bot"
}
```

**Response `200`**
```json
{
  "id": "a8c7...",
  "agentId": "agent-123",
  "pool": "gpus-us-east",
  "delta": 1,
  "status": "applied",
  "sentinelDecision": { "allowed": true, "policyId": "sentinel-allow", "reason": "approved" },
  "appliedBy": "allocator-bot",
  "appliedAt": "2025-01-17T18:15:00Z"
}
```

If SentinelNet blocks, status becomes `rejected` and `sentinelDecision` includes the policy/reason.

### `GET /alloc/{id}`
Fetches an allocation request with timestamps and SentinelNet decision payload.

### `GET /alloc/pools`
Lists configured pools and capacities.

**Response `200`**
```json
{ "pools": [ { "name": "gpus-us-east", "capacity": 10 } ] }
```

---

## SentinelNet policy behavior
The scaffolded allocator uses `RESOURCE_ALLOCATOR_DENY_POOLS` (comma-delimited) and `RESOURCE_ALLOCATOR_MAX_DELTA` env vars to simulate SentinelNet policies:
- If the requested `pool` matches a denied pool, approval fails with policy `sentinel-deny-pool`.
- If `delta` exceeds `RESOURCE_ALLOCATOR_MAX_DELTA`, approval fails with policy `sentinel-max-delta`.

The resulting decision is stored in `allocation_requests.sentinel_decision` and returned to callers.

---

## Acceptance test
Run `go test ./eval-engine/internal/acceptance -run PromotionAllocation` to exercise:
1. Eval report ingestion
2. Auto-promotion and allocation request creation
3. Resource Allocator approval with SentinelNet allow + deny scenarios

---

End of file.
