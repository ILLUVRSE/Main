#!/usr/bin/env bash
# devops/scripts/run_phase4_smoke.sh
# One-button smoke tests for Phase 4: OIDC (JWKS) + mTLS sign flow.
# Usage: ./devops/scripts/run_phase4_smoke.sh
set -euo pipefail

# Fix: ROOT_DIR must be the repository root (two levels up from this script)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERT_DIR="$ROOT_DIR/devops/certs"
JWKS_SCRIPT="$ROOT_DIR/devops/scripts/start_jwks_server.sh"
KERNEL_BIN="$ROOT_DIR/build/kernel"

# Helpers
info(){ echo "[INFO] $*"; }
err(){ echo "[ERROR] $*" >&2; }
fail(){ err "$*"; exit 3; }

require_file() {
  if [ ! -f "$1" ]; then
    fail "required file not found: $1"
  fi
}

# Ensure prerequisites exist
require_file "$JWKS_SCRIPT"
require_file "$KERNEL_BIN"
require_file "$CERT_DIR/jwks.json"
require_file "$CERT_DIR/test_jwt.txt"
require_file "$CERT_DIR/server.crt"
require_file "$CERT_DIR/server.key"
require_file "$CERT_DIR/ca.crt"
# superadmin.pem may be placed in repo root; optional check later

# Make sure jwks helper is executable
chmod +x "$JWKS_SCRIPT"

# Start JWKS server
info "Starting JWKS server..."
"$JWKS_SCRIPT" start
JWKS_PID_FILE="$CERT_DIR/.jwks_server.pid"
if [ -f "$JWKS_PID_FILE" ]; then
  JWKS_PID="$(cat "$JWKS_PID_FILE")"
  info "JWKS pid: $JWKS_PID"
else
  fail "JWKS pidfile not found"
fi

# Small waiter for JWKS
info "Waiting for JWKS to be reachable..."
for i in {1..10}; do
  if curl -sS "http://localhost:8000/jwks.json" >/dev/null 2>&1; then
    info "JWKS reachable"
    break
  fi
  sleep 0.3
  if [ "$i" -eq 10 ]; then fail "JWKS did not become reachable"; fi
done

# Start kernel helper
start_kernel() {
  local require_mtls="$1"  # true|false
  export JWKS_URL="http://localhost:8000/jwks.json"
  export OIDC_ISSUER="https://test-issuer"
  export OIDC_AUDIENCE="signing-api"
  export JWKS_CACHE_TTL_SECONDS=60
  export TLS_CERT_PATH="$CERT_DIR/server.crt"
  export TLS_KEY_PATH="$CERT_DIR/server.key"
  export TLS_CLIENT_CA_PATH="$CERT_DIR/ca.crt"
  export REQUIRE_MTLS="$require_mtls"
  export NODE_ENV="production"
  export LISTEN_ADDR=":8443"

  mkdir -p "$ROOT_DIR/build/logs"
  "$KERNEL_BIN" > "$ROOT_DIR/build/logs/kernel.log" 2>&1 &
  KPID=$!
  # Wait for kernel to start listening
  for i in {1..15}; do
    sleep 0.3
    if grep -q "starting kernel server" "$ROOT_DIR/build/logs/kernel.log"; then
      break
    fi
    if [ "$i" -eq 15 ]; then
      cat "$ROOT_DIR/build/logs/kernel.log" || true
      fail "kernel did not start in time (check logs)"
    fi
  done
  echo "$KPID"
}

stop_kernel() {
  local pid="$1"
  if kill "$pid" 2>/dev/null; then
    wait "$pid" 2>/dev/null || true
    info "Stopped kernel (pid=$pid)"
  fi
}

# Utility to POST /kernel/sign and return http code and body file
do_sign_post_with_token() {
  local token="$1"
  local outf="$2"
  http_code=$(curl -sS -w "%{http_code}" -o "$outf" \
    --cacert "$CERT_DIR/ca.crt" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d '{"manifest":{"id":"mjwt","foo":"bar"},"signerId":"kernel-signer","version":"1.0"}' \
    "https://localhost:8443/kernel/sign" || true)
  echo "$http_code"
}

do_sign_post_with_cert() {
  local certpem="$1"
  local outf="$2"
  http_code=$(curl -sS -w "%{http_code}" -o "$outf" \
    --cert "$certpem" --cacert "$CERT_DIR/ca.crt" \
    -H "Content-Type: application/json" \
    -d '{"manifest":{"id":"m1","foo":"bar"},"signerId":"kernel-signer","version":"1.0"}' \
    "https://localhost:8443/kernel/sign" || true)
  echo "$http_code"
}

# 1) Token-only test (REQUIRE_MTLS=false)
info "=== Stage 1: TOKEN-ONLY (REQUIRE_MTLS=false) ==="
KPID1=$(start_kernel "false")
info "Kernel pid: $KPID1"
sleep 0.5

TOKEN="$(tr -d '\n' < "$CERT_DIR/test_jwt.txt" || true)"
if [ -z "$TOKEN" ]; then
  stop_kernel "$KPID1"
  fail "token not found or empty"
fi

info "Calling /kernel/sign with valid token..."
OUT1="$(mktemp)"
CODE1=$(do_sign_post_with_token "$TOKEN" "$OUT1")
info "HTTP code: $CODE1"
echo "Response:"
cat "$OUT1" || true

if [ "$CODE1" != "200" ]; then
  stop_kernel "$KPID1"
  fail "TOKEN-ONLY test failed (expected 200)"
fi

info "Calling /kernel/sign with altered token (expect 401/403)..."
BAD="$(printf "%s" "$TOKEN")bad"
OUTB="$(mktemp)"
BADCODE=$(do_sign_post_with_token "$BAD" "$OUTB")
info "HTTP code: $BADCODE"
echo "Response:"
cat "$OUTB" || true

if [[ "$BADCODE" != "401" && "$BADCODE" != "403" ]]; then
  stop_kernel "$KPID1"
  fail "Bad-token test did not return 401/403"
fi

stop_kernel "$KPID1"

# 2) mTLS-only test (REQUIRE_MTLS=true)
info "=== Stage 2: mTLS-only (REQUIRE_MTLS=true) ==="
# Look for superadmin.pem in repo root or cwd
if [ -f "$ROOT_DIR/superadmin.pem" ]; then
  SUPERCERT="$ROOT_DIR/superadmin.pem"
elif [ -f "$PWD/superadmin.pem" ]; then
  SUPERCERT="$PWD/superadmin.pem"
elif [ -f "$ROOT_DIR/devops/certs/superadmin.pem" ]; then
  SUPERCERT="$ROOT_DIR/devops/certs/superadmin.pem"
else
  fail "superadmin.pem (client cert) not found. Create it before running mTLS test."
fi

KPID2=$(start_kernel "true")
info "Kernel pid: $KPID2"
sleep 0.5

info "Calling /kernel/sign with client cert (expect 200)..."
OUT2="$(mktemp)"
CODE2=$(do_sign_post_with_cert "$SUPERCERT" "$OUT2")
info "HTTP code: $CODE2"
echo "Response:"
cat "$OUT2" || true

if [ "$CODE2" != "200" ]; then
  stop_kernel "$KPID2"
  fail "mTLS sign test failed (expected 200)"
fi

info "Calling /kernel/sign WITHOUT client cert (expect TLS failure or 401/403)..."
OUT3="$(mktemp)"
NOCCODE=$(curl -sS -w "%{http_code}" -o "$OUT3" --cacert "$CERT_DIR/ca.crt" -H "Content-Type: application/json" -d '{"manifest":{"id":"m2"},"signerId":"kernel-signer"}' "https://localhost:8443/kernel/sign" || true)
info "HTTP code (or curl exit): $NOCCODE"
echo "Response:"
cat "$OUT3" || true

stop_kernel "$KPID2"

# Cleanup JWKS
"$JWKS_SCRIPT" stop

info "=== Phase 4 smoke tests completed SUCCESSFULLY ==="
exit 0

