# IDEA — Acceptance Criteria

Purpose: verifiable, automated checks proving IDEA (Creator API + Kernel adapter) works, is secure, auditable, and production-ready.

## # 1) Core Creator API correctness
- All documented endpoints respond with expected status codes and JSON shapes:
  - `POST /api/v1/package`, `POST /api/v1/package/complete`
  - `POST /api/v1/kernel/submit`, `POST /api/v1/kernel/callback`
  - `POST /api/v1/sandbox/run`, `GET /api/v1/sandbox/run/{id}`
  - `POST /api/v1/agent/save`, `GET /api/v1/agent/{id}`
- Automated contract tests (integration) exercise each endpoint using real or mocked dependencies and assert shape + `ok:true`.

## # 2) Kernel submit flow (end-to-end)
- **Package & upload**: `POST /package` returns a presigned upload URL; client can PUT bundle; `POST /package/complete` returns `artifact_url` with correct `sha256`.
- **Submit**: `POST /kernel/submit` forwards sign request to Kernel (or enqueues) and returns either signed manifest (sync) or accepted + validation_id (async).
- **Callback**: Kernel callback verified for `X-Kernel-Signature`, `X-Kernel-Timestamp` (+/-2m), `X-Kernel-Nonce` replay protection. If PASS, IDEA stores manifest and emits `kernel_validated` audit event.

## # 3) Sandbox & test harness
- Sandbox runs test commands specified in agent_config/tests and returns `passed|failed`. CI should run a deterministic smoke sandbox job.
- Sandbox enforces CPU/memory/timebox and returns correct `timeout` status.

## # 4) Security & signing
- JWT-based auth validated for human flows. `Authorization: Bearer <JWT>` accepted and validated by middleware.
- Kernel callback signature verification validated in unit tests (HMAC and RSA code paths covered).
- Interface enforces `Idempotency-Key` semantics for `package`, `package/complete`, `kernel/submit`.

## # 5) Audit & observability
- Every write endpoint emits an EventBus audit event containing `actor_id`, `endpoint`, `status`, `duration_ms`, `request_id`.
- Kernel submit metrics `kernel.submit.latency`, `kernel.validation.pass_rate` are present and exported.
- Logs include `request_id` and raw body for callback verification only if secure logging is enabled.

## # 6) Failure & recovery
- If Kernel is unreachable during `kernel/submit`, IDEA persists the request with `retries` and backoff and exposes retries via `/admin/` (or logs).
- Replayed callback `X-Kernel-Nonce` rejects duplicate processing.

## # 7) Developer UX & docs
- `./scripts/setup_local.sh` provisions local dev environment and the README developer instructions produce a runnable IDEA + Kernel local setup.

## # Verification
- Provide a CI job that runs:
  - contract tests for endpoints,
  - end-to-end package → upload → complete → submit (mock kernel for sync + async),
  - sandbox run integration test,
  - kernel callback verification tests.

