# IDEA — Technical Specification (Creator API + Kernel Adapter)

This file defines the canonical behavior, request/response shapes, and runtime obligations for the IDEA Creator API and the Kernel submission adapter.

## Conventions
- Refer to global repo conventions: UUIDv4 IDs, ISO8601 UTC times, SHA-256 hex checksums, `ok:true` for success.
- All API endpoints are JSON over HTTPS. All write endpoints accept `Idempotency-Key`.

## Authentication & RBAC
- Human auth: JWT with `roles` claim (`creator|admin|reviewer`). Middleware must validate token against Kernel/OIDC JWKS (configurable).
- Service auth: mTLS for Kernel or other service calls.
- `X-Request-Id` optional but recommended.

## Key JSON schemas (canonical URIs)
- `https://idea.illuvrse/schema/agent_config`
- `https://idea.illuvrse/schema/agent_bundle`
- `https://idea.illuvrse/schema/kernel_sign_request`
- `https://idea.illuvrse/schema/kernel_signed_manifest`

(Full schemas are mirrored in README.md; this file focuses on operational semantics and important validation rules.)

## Important behaviors & validations
### `POST /api/v1/package`
- Validates caller is authorized to package `agent_id`.
- Creates artifact record with `artifact_id`, `upload_url`, `artifact_max_size`.
- Returns expected `expected_sha256` optionally.

### `POST /api/v1/package/complete`
- Accepts `artifact_id`, `sha256`.
- IDEA verifies uploaded artifact metadata if storage supports HEAD checks.
- If mismatch, return `409 conflict`.

### `POST /api/v1/kernel/submit`
- Verify `sha256` length & format; perform optional HEAD/object-size check.
- If `profile=illuvrse` require `agent_config.tests` exist and prior sandbox run `passed`.
- Forward to Kernel using:
  - mTLS client certificate if configured, or
  - Kernel JWT (server-to-server) using signing service account.
- Record `Idempotency-Key` to avoid duplicate processing.

### `POST /api/v1/kernel/callback`
- Verify `X-Kernel-Signature` against body (support HMAC-SHA256 and RSA/Ed25519 per Kernel docs).
- Enforce `X-Kernel-Timestamp` within ±2 minutes.
- Persist `X-Kernel-Nonce` for replay protection.
- If signature valid and `status=PASS`:
  - persist `kernel_signed_manifest`,
  - emit `kernel_validated` audit event (include manifestSignatureId, signer_kid).
- If `FAIL`, persist diagnostics and alert owner.

## Event & Audit contract
- IDEA emits `kernel_submitted`, `kernel_validated`, `package_created`, `sandbox_run` events with:
  - `actor_id`, `agent_id`, `artifact_sha256`, `timestamp`, `signature`.
- Events must be signed by the server key or KMS-sourced signature (specify `signer_kid`).

## Errors
- Standard `ok:false` structure and machine codes (`validation_error`, `bad_request`, `unauthorized`, `conflict`, `server_error`).

## Retry & Idempotency
- Write endpoints respect `Idempotency-Key`. Duplicate requests with same key return original result or a consistent error.

