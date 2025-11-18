# Eval Engine — API & Contract

**Base URL (examples)**

* Local dev: `http://localhost:8050`
* Staging/prod: `https://eval-engine.{env}.illuvrse.internal`

**Security**

* Kernel-only write operations: **mTLS** preferred; alternatives: kernel-signed bearer token (must be validated server-side).
* Human/operator endpoints: OIDC (SSO) and must map claims -> roles (e.g., `eval-admin`, `operator`).
* All state-changing requests must include `X-Request-Id` and optionally `Idempotency-Key` for safe retries.

**Error format (canonical)**
All responses on error MUST follow:

```json
{
  "ok": false,
  "error": {
    "code": "SOME_CODE",
    "message": "Human readable explanation",
    "details": { /* optional: structured details */ }
  }
}
```

**Success envelope**
Write responses and many read responses use:

```json
{ "ok": true, ... }
```

---

## Top-level headers (recommended)

* `X-Request-Id`: string (UUID) — for tracing/log correlation.
* `Idempotency-Key`: string — for safe dedup of non-idempotent operations.
* `Authorization`: `Bearer <token>` or mTLS client cert.

---

## Endpoints

### 1) POST `/eval/submit` — submit an EvalReport (Kernel → Eval Engine)

**Purpose:** ingest evaluation reports from agents or evaluation pipelines. Must accept either camelCase or snake_case keys per Kernel contract.

**Security:** Kernel-only (mTLS or Kernel-signed token).

**Request body (JSON):**

```json
{
  "id": "eval-uuid-1",           // optional; server may generate
  "agentId": "agent-123",        // or agent_id (snake_case)
  "metricSet": { "accuracy": 0.92, "latency_ms": 120 },
  "timestamp": "2025-11-18T12:00:00Z",
  "computedScore": 0.92,
  "source": "runner:v1",
  "window": "2025-11-17T00:00:00Z/2025-11-17T23:59:59Z",
  "metadata": { "dataset": "v1", "jobId": "job-42" }
}
```

**Responses**

* `200` — accepted/processed:

  ```json
  { "ok": true, "eval_id": "eval-uuid-1" }
  ```
* `400` — invalid payload
* `401/403` — unauthorized / not Kernel

**Semantics**

* Writes must be idempotent when client provides `Idempotency-Key`. If same `Idempotency-Key` seen, return same `eval_id` / outcome.
* On successful ingestion emit an AuditEvent linking to Kernel manifestSignatureId where available and include `actor_id` = `service:eval-engine`.
* Integration tests should cover both camelCase and snake_case payloads.

---

### 2) POST `/eval/promote` — request a promotion/recommendation action (Eval Engine → Resource Allocator kernel mediated)

**Purpose:** ask Eval Engine to create a PromotionEvent (recommend promotion of an ML artifact, model, or agent), which will be recorded to Reasoning Graph and sent for gating.

**Security:** Kernel-authorized or Kernel-proxied — promotions must be validated by Kernel before applying.

**Request body (JSON):**

```json
{
  "requestId": "promo-20251118-01",
  "artifactId": "model-artifact-abc",
  "reason": "score_delta>0.02 for 24h",
  "score": 0.93,
  "confidence": 0.88,
  "evidence": {
    "eval_reports": ["eval-uuid-1","eval-uuid-2"],
    "metrics_summary": { "prev_score": 0.90, "new_score": 0.93 }
  },
  "target": { "env": "staging", "traffic_percent": 10 },
  "audit_context": { "kernel_manifest_signature_id": "manifest-sig-xyz" },
  "idempotency_key": "promo-20251118-01"
}
```

**Responses**

* `202` — Promotion accepted (queued / pending policy check)

  ```json
  { "ok": true, "promotion_id": "promo-20251118-01", "status": "pending" }
  ```
* `400` — invalid request
* `403` — gated / denied by SentinelNet (if synchronous) or on enforcement
* `409` — duplicate promotion (idempotency mismatch)

**Semantics & Contracts**

* Promotions must be recorded in Reasoning Graph as `Decision` nodes with `metadata` including `manifest_signature_id`, evidence references, and `audit_context`.
* If SentinelNet gating is synchronous for this promotion type, Eval Engine must call SentinelNet policy check and abort with `403` if denied, including `policy_decision` in details.
* Promotions must support multisig gating for critical environment promotions (3-of-5 approvals). If policy requires multisig, respond `202` with `status: pending_multisig` and the Kernel/Control-Panel will handle approvals.
* On promotion acceptance, emit AuditEvent.

---

### 3) POST `/alloc/request` — request resource/capital allocation (Resource Allocator)

**Purpose:** request compute/capital resources for an entity (agent/model/canary). In many flows this is invoked by Kernel or Eval Engine after promotion.

**Security:** Kernel-authenticated (mTLS or Kernel-signed token). For operator-initiated allocations allow OIDC with `alloc_admin` role.

**Request body (JSON):**

```json
{
  "id": "alloc-20251118-001",           // optional
  "entity_id": "agent-123",
  "division_id": "division-1",
  "pool": "gpu",
  "cpu": 4,
  "gpu": 1,
  "memoryMB": 8192,
  "duration_seconds": 3600,
  "reason": "canary rollout for model-artifact-abc",
  "requested_by": "service:eval-engine",
  "requested_at": "2025-11-18T12:10:00Z",
  "idempotency_key": "alloc-20251118-001",
  "audit_context": { "kernel_manifest_signature_id": "manifest-sig-xyz" }
}
```

**Responses**

* `200` — allocation assigned/accepted:

  ```json
  {
    "ok": true,
    "allocation_id": "alloc-20251118-001",
    "status": "reserved",
    "details": { "pool": "gpu", "allocated_cpu": 4, "allocated_gpu": 1 }
  }
  ```
* `202` — allocation accepted but pending external approval (Finance or multisig)
* `403` — denied by SentinelNet or RBAC
* `409` — duplicate idempotency request
* `400` — bad payload

**Semantics**

* Allocations must create ledger reservation via Finance (or call Finance to record reservation). If Finance returns failure, allocation finalization must fail.
* Allocations must be idempotent and support retry/backoff for external failures.
* When final allocation is applied, emit AuditEvent and link the ledger proof/ledger id.

---

### 4) POST `/alloc/settle` — finalize settlement after allocation & finance confirmation

**Purpose:** called when Finance confirms payment/ledger proof (for capital allocations) — this finalizes allocation and triggers actual resource issue.

**Security:** Kernel-authenticated or internal service-to-service (mTLS).

**Request body:**

```json
{
  "allocation_id": "alloc-20251118-001",
  "ledger_proof_id": "ledger-proof-20251118-01",
  "settled_at": "2025-11-18T12:20:00Z",
  "idempotency_key": "settle-alloc-20251118-001"
}
```

**Responses**

* `200` — settled and resources issued:

  ```json
  { "ok": true, "allocation_id": "alloc-20251118-001", "status": "settled" }
  ```
* `400/404` — invalid allocation or missing ledger proof
* `409` — duplicate settlement (idempotent)

**Semantics**

* Settlement must validate ledger proof signature and balanced entries (Finance must ensure double-entry).
* If ledger verification fails, settlement must reject and emit a reconciled error. Emit AuditEvent.

---

### 5) GET `/alloc/{id}` — fetch allocation status

**Purpose:** query allocation state, ledger/settlement linkage, assigned resources.

**Response**

```json
{
  "ok": true,
  "allocation": {
    "allocation_id": "alloc-20251118-001",
    "entity_id": "agent-123",
    "status": "reserved|allocated|settled|failed|released",
    "resources": { "cpu": 4, "gpu": 1, "memoryMB": 8192 },
    "ledger_proof_id": "ledger-proof-20251118-01",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Errors:** `404` if not found.

---

### 6) GET `/metrics` — Prometheus metrics endpoint

Expose metrics required by blueprint: `eval_engine.eval_submissions_total`, `eval_engine.promotion_latency_seconds`, `allocator.allocations_total`, `allocator.settlement_failures_total`, etc.

---

### 7) Admin / operational endpoints (restricted)

* `GET /health`, `GET /ready` — must reflect Kernel connectivity, SentinelNet availability, Finance connectivity, DB health.
* `POST /admin/reconcile` — admin-only; trigger reconciliation run between allocations and finance ledger. Must require `eval-admin` role + mTLS or multisig for dangerous ops.
* `POST /admin/replay` — re-run promotion/allocation from audit logs for DR (needs strict auth).

---

## Contract guarantees, idempotency, & audit

**Idempotency**

* All write endpoints accept `Idempotency-Key`. Clients may retry safely; server must deduplicate and return the original semantic result.

**Audit**

* Every write must create an AuditEvent with `prevHash`, `hash`, `signature` and reference Kernel manifest where applicable. AuditEvent must include `actor_id` and `request_id`.
* Promotion / allocation flows must reference the kernel manifestSignatureId (in `audit_context`) so audit replay can link artifacts back to Kernel.

**SentinelNet policy**

* Promotion and allocation flows must call SentinelNet for policy decisions whenever policy scope includes the action:

  * If `sentinel_decision == deny` → operation must abort with `403` and include `policy` details in `error.details`.
  * If `policy == requires_multisig` → operation transitions to `pending_multisig` and must record the upgrade manifest submitted to Kernel.

**Finance integration**

* Allocation finalization depends on Finance signed ledger proof. `alloc/settle` must validate ledger proof signature (via KMS/public key registry) and require `balanced` verification. If Finance is unresponsive, allocation must remain pending and be safely retryable.

---

## Examples of tests / acceptance checks

* Contract tests asserting JSON shapes, `ok:true` semantics, and error format.
* `POST /eval/submit` with both camelCase and snake_case payloads; assert `200`.
* `POST /eval/promote` should create Reasoning Graph Decision node and record AuditEvent.
* Promotion gated by SentinelNet: mock SentinelNet to deny/allow and assert `403` and `202` semantics respectively.
* Allocation → Finance → Settlement end-to-end acceptance e2e: allocate, simulate payment, create ledger proof, call `alloc/settle`, assert `status: settled` and signed ledger proof link included.

---

## Observability & metrics (P1)

Expose counters/histograms:

* `eval_engine.eval_submissions_total` (counter)
* `eval_engine.eval_submission_latency_seconds` (histogram)
* `eval_engine.promotions_total` (counter, labels: status/policy)
* `allocator.allocations_total` (counter)
* `allocator.allocation_latency_seconds` (histogram)
* `allocator.settlement_failures_total` (counter)
* `eval_engine.promotion_policy_denials_total` (counter)

---

## Notes & operational considerations

* Use shared canonicalization library from Kernel for hash/signature parity.
* For local dev, allow `DEV_SKIP_MTLS=true`, but server must refuse to start with `NODE_ENV=production` and `DEV_SKIP_MTLS=true`.
* Provide retry/backoff and dead-letter for external dependency errors (Finance, SentinelNet, vector provider if used).
* All admin endpoints must be auditable and guarded by roles + optional multisig for dangerous operations.

---

## Signoffs

* Required: `eval-engine/signoffs/security_engineer.sig` and `eval-engine/signoffs/ryan.sig` before final acceptance.

---
