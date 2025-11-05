#!/usr/bin/env bash
# devops/scripts/generate_mtls_certs.sh
# Idempotent cert generation for local mTLS tests.
# Creates: devops/certs/{ca.key,ca.crt,server.key,server.crt,client.key,client.crt,client.p12,openssl.cnf}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${SCRIPT_DIR}/../certs"
mkdir -p "${CERT_DIR}"

# Files
OPENSSL_CNF="${CERT_DIR}/openssl.cnf"
CA_KEY="${CERT_DIR}/ca.key"
CA_CRT="${CERT_DIR}/ca.crt"
CA_SRL="${CERT_DIR}/ca.srl"
SERVER_KEY="${CERT_DIR}/server.key"
SERVER_CSR="${CERT_DIR}/server.csr"
SERVER_CRT="${CERT_DIR}/server.crt"
CLIENT_KEY="${CERT_DIR}/client.key"
CLIENT_CSR="${CERT_DIR}/client.csr"
CLIENT_CRT="${CERT_DIR}/client.crt"
CLIENT_P12="${CERT_DIR}/client.p12"

# Create openssl.cnf if missing
if [ ! -f "${OPENSSL_CNF}" ]; then
  cat > "${OPENSSL_CNF}" <<'EOF'
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = kernel.local

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF
  echo "wrote ${OPENSSL_CNF}"
else
  echo "openssl.cnf exists, skipping"
fi

# Generate CA
if [ ! -f "${CA_KEY}" ]; then
  openssl genrsa -out "${CA_KEY}" 4096
  echo "generated ${CA_KEY}"
else
  echo "CA key exists, skipping"
fi

if [ ! -f "${CA_CRT}" ]; then
  openssl req -x509 -new -nodes -key "${CA_KEY}" -sha256 -days 3650 -out "${CA_CRT}" -subj "/CN=ILLUVRSE-TEST-CA"
  echo "generated ${CA_CRT}"
else
  echo "CA cert exists, skipping"
fi

# Server cert
if [ ! -f "${SERVER_KEY}" ]; then
  openssl genrsa -out "${SERVER_KEY}" 2048
  echo "generated ${SERVER_KEY}"
else
  echo "Server key exists, skipping"
fi

if [ ! -f "${SERVER_CSR}" ]; then
  openssl req -new -key "${SERVER_KEY}" -out "${SERVER_CSR}" -config "${OPENSSL_CNF}"
  echo "generated ${SERVER_CSR}"
else
  echo "Server CSR exists, skipping"
fi

if [ ! -f "${SERVER_CRT}" ]; then
  # Use -CAcreateserial which will create ca.srl if missing
  openssl x509 -req -in "${SERVER_CSR}" -CA "${CA_CRT}" -CAkey "${CA_KEY}" -CAcreateserial -out "${SERVER_CRT}" -days 365 -extensions v3_req -extfile "${OPENSSL_CNF}"
  echo "generated ${SERVER_CRT}"
else
  echo "Server cert exists, skipping"
fi

# Client cert
if [ ! -f "${CLIENT_KEY}" ]; then
  openssl genrsa -out "${CLIENT_KEY}" 2048
  echo "generated ${CLIENT_KEY}"
else
  echo "Client key exists, skipping"
fi

if [ ! -f "${CLIENT_CSR}" ]; then
  openssl req -new -key "${CLIENT_KEY}" -out "${CLIENT_CSR}" -subj "/CN=client-1"
  echo "generated ${CLIENT_CSR}"
else
  echo "Client CSR exists, skipping"
fi

if [ ! -f "${CLIENT_CRT}" ]; then
  openssl x509 -req -in "${CLIENT_CSR}" -CA "${CA_CRT}" -CAkey "${CA_KEY}" -CAcreateserial -out "${CLIENT_CRT}" -days 365
  echo "generated ${CLIENT_CRT}"
else
  echo "Client cert exists, skipping"
fi

# Optional PKCS12
if [ ! -f "${CLIENT_P12}" ]; then
  openssl pkcs12 -export -out "${CLIENT_P12}" -inkey "${CLIENT_KEY}" -in "${CLIENT_CRT}" -passout pass:password
  echo "generated ${CLIENT_P12} (password: password)"
else
  echo "Client p12 exists, skipping"
fi

echo "All done. Certs in: ${CERT_DIR}"

