# Kernel KMS + mTLS

Kernel signs manifests and audit artifacts via an external KMS `/sign` API with mutual TLS. When the endpoint is absent (local/dev only) it falls back to an Ed25519 key provided in `KERNEL_SIGNER_KEY_B64`.

## Environment
- `KERNEL_KMS_ENDPOINT` – base URL for the KMS service (no trailing slash)
- `KERNEL_KMS_KEY_ID` – optional logical key identifier forwarded to the KMS
- `KERNEL_SIGNER_KEY_B64` – base64 Ed25519 private key (fallback signing only)
- `KERNEL_CLIENT_CERT` / `KERNEL_CLIENT_KEY` – PEM client certificate + key for mTLS (value or file path)
- `KERNEL_CA_CERT` – PEM CA bundle to trust the KMS server
- `KMS_TIMEOUT_MS` – request timeout in milliseconds (default 3000)

## Behavior
- `/sign` is called with `{ "payload_b64": "<base64>" }`; expects `{ "signature_b64", "signer_id" }`.
- `/verify` is called with `{ payload_b64, signature_b64, signer_id }` when available.
- mTLS is used when client cert/key are present; server verification uses `KERNEL_CA_CERT` or system roots.
- If KMS is unreachable or returns 4xx/5xx, signing falls back to the Ed25519 key and labels the signer as `local-ed25519:<sha256prefix>`.
- Timeouts default to 3s with one retry on transient or 5xx responses.

## Local development
```
export KERNEL_SIGNER_KEY_B64=$(python - <<'PY'
import base64, os
print(base64.b64encode(os.urandom(32)).decode())
PY
)
export DEV_SKIP_MTLS=true
```
Run the signing tests: `go test ./kernel/internal/signing`.

## cURL example
```
payload=$(printf 'hello-kms' | base64 | tr -d '\n')
curl --cert "$KERNEL_CLIENT_CERT" --key "$KERNEL_CLIENT_KEY" ${KERNEL_CA_CERT:+--cacert "$KERNEL_CA_CERT"} \
  -H "Content-Type: application/json" \
  -d "{\"payload_b64\":\"${payload}\"}" \
  "${KERNEL_KMS_ENDPOINT}/sign"
```

## Failure modes
- Missing KMS endpoint **and** `KERNEL_SIGNER_KEY_B64` → fail startup in production.
- Malformed JSON/invalid base64 from KMS → treated as a KMS failure and falls back only when the local key is present.
- `DEV_SKIP_MTLS=true` is guarded in CI for `main/prod`; runs will fail fast if mTLS is skipped.
