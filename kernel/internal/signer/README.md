# KMS Signer (kernel/internal/signer)

This package contains the Kernel signer implementations:
- `LocalSigner` (dev-only in-process Ed25519 signer)
- `KMSSigner` (production-focused signer that delegates signing to an external KMS service)

## Behavior

- `KMSSigner` calls the external KMS endpoints:
  - `POST <KMS_ENDPOINT>/signData` with JSON `{ "signerId": "<id>", "data": "<base64>" }`.
    Expects JSON response with `signature` (base64) and optionally `signerId`.
  - Optional `POST <KMS_ENDPOINT>/publicKey` that returns `{ "publicKey": "<base64>" }` (used to register public key in the kernel registry).

- Authentication to KMS:
  - mTLS: provide `KMS_MTLS_CERT_PATH` and `KMS_MTLS_KEY_PATH` (PEM files). Optionally `KMS_MTLS_CA_PATH` to verify the server certificate.
  - Bearer token: `KMS_BEARER_TOKEN` env var. mTLS is preferred when both are present.

- Production semantics:
  - If `REQUIRE_KMS=true`, the server fails fast when KMS is not configured or unavailable.
  - If `REQUIRE_KMS=false`, the code will fall back to a local ephemeral Ed25519 signature (development only).

## Environment variables

- `KMS_ENDPOINT` - base URL of the KMS service (no trailing slash required).
- `SIGNER_ID` - logical signer id reported by KMS.
- `KMS_BEARER_TOKEN` - optional bearer token for KMS.
- `KMS_MTLS_CERT_PATH` - client cert PEM for mTLS (optional).
- `KMS_MTLS_KEY_PATH` - client key PEM for mTLS (optional).
- `KMS_MTLS_CA_PATH` - CA bundle (PEM) used to validate KMS server cert (optional).
- `KMS_TIMEOUT_MS` - request timeout in milliseconds (default 5000).
- `REQUIRE_KMS` - when true, server will fail to start if KMS is not available.

## Tests

- `kms_signer_test.go` - basic non-mTLS test that spins up an HTTP test server responding to `/signData`.
- `kms_signer_mtls_test.go` - test that spins up a TLS test server requiring client certificates and verifies mTLS signing.

Run tests:
```bash
go test ./kernel/internal/signer -v

Security note

The ephemeral fallback is strictly for development and testing. Do not rely on ephemeral signing in production. Enforce REQUIRE_KMS=true in production environments and ensure KMS credentials / certs are provisioned securely.
