# SentinelNet KMS + mTLS

SentinelNet signs policy decisions via a KMS `/sign` API using mutual TLS when configured. Local development can fall back to a base64 Ed25519 key (`SENTINEL_SIGNER_KEY_B64`), but production must use KMS + mTLS.

## Environment
- `SENTINEL_KMS_ENDPOINT` – base URL for the KMS signer
- `SENTINEL_SIGNER_KEY_B64` – base64 Ed25519 private key for dev fallback
- `SENTINEL_CLIENT_CERT` / `SENTINEL_CLIENT_KEY` – PEM client certificate + key (value or file path)
- `SENTINEL_CA_CERT` – PEM CA bundle for KMS server validation
- `KMS_TIMEOUT_MS` – request timeout in milliseconds (default 3000)
- `DEV_SKIP_MTLS` – only for dev; CI blocks this on `main`/`prod`

## Behavior
- `/sign` invoked with `{ payload_b64 }`, expecting `{ signature_b64, signer_id }`.
- `/verify` invoked with `{ payload_b64, signature_b64, signer_id }` when available.
- One retry on transient/5xx errors; otherwise falls back to local Ed25519 if configured.
- Fallback signer ID: `local-ed25519:<first-8-hex-of-sha256(pub)>`.
- No secrets are logged; mTLS is used automatically when cert/key are provided.

## Local development
```
cat > .env.local <<'EOF'
DEV_SKIP_MTLS=true
SENTINEL_SIGNER_KEY_B64=$(python - <<'PY'
import base64, os
print(base64.b64encode(os.urandom(32)).decode())
PY
)
EOF

npm test -- --runInBand
```

## cURL example
```
payload=$(printf 'policy-hello' | base64 | tr -d '\n')
curl --cert "$SENTINEL_CLIENT_CERT" --key "$SENTINEL_CLIENT_KEY" ${SENTINEL_CA_CERT:+--cacert "$SENTINEL_CA_CERT"} \
  -H "Content-Type: application/json" \
  -d "{\"payload_b64\":\"${payload}\"}" \
  "${SENTINEL_KMS_ENDPOINT}/sign"
```

## Failure modes
- Missing KMS endpoint **and** `SENTINEL_SIGNER_KEY_B64` → startup/signing failure.
- Malformed JSON/invalid base64 from KMS → treated as KMS failure; falls back only when the local key exists.
- CI guard fails immediately when `DEV_SKIP_MTLS=true` on `main/prod` or when required KMS endpoint variables are absent.
