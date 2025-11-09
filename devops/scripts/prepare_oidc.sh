#!/usr/bin/env bash
# devops/scripts/prepare_oidc.sh
# Generate OIDC/TLS fixtures for tests (CA, server key/cert) and write a secret JSON
# Usage in CI: provide the secret via env (for example via a repo secret)
set -euo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/kernel/test/fixtures/oidc"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

# Use CLIENT_SECRET supplied in environment. Do not default to a literal fallback.
if [ -z "${CLIENT_SECRET:-}" ]; then
  echo "ERROR: required client secret is not set. Export a secret in the environment before running this script."
  echo "In CI, set the secret via repository Actions secrets (TEST_CLIENT_SECRET) and pass it into this job."
  exit 1
fi

echo "Generating OIDC/TLS fixtures into: $OUT_DIR"

# Cleanup previous generated files (safe)
rm -f ca.key ca.crt ca.srl server.key server.csr server.crt san.ext secret.json

# Create CA key and cert
openssl genrsa -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -subj "/CN=ILLUVRSE Test CA" -days 3650 -out ca.crt

# Create server key + CSR, with SAN for localhost and 127.0.0.1
openssl genrsa -out server.key 2048
cat > san.ext <<EOF
subjectAltName = DNS:localhost,IP:127.0.0.1
EOF
openssl req -new -key server.key -subj "/CN=localhost" -out server.csr
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365 -extfile san.ext

# Tighten permissions
chmod 600 server.key ca.key
chmod 644 server.crt ca.crt

# Write secret JSON used by tests / scripts (contains only the provided value)
SECRET_JSON="{\"value\":\"${CLIENT_SECRET}\"}"
printf '%s\n' "$SECRET_JSON" > secret.json

# Output the paths so CI can pick them up easily
echo "SERVER_KEY_PATH=$OUT_DIR/server.key"
echo "SERVER_CERT_PATH=$OUT_DIR/server.crt"
echo "CA_PATH=$OUT_DIR/ca.crt"
echo "SECRET_JSON=$OUT_DIR/secret.json"

echo "Done."

