#!/usr/bin/env bash
# memory-layer/service/audit/ci-env-setup.sh
#
# CI / local helper to set up environment for running Memory Layer integration tests
# with a deterministic signing setup and optional mock signing proxy.
#
# Usage:
#   ./memory-layer/service/audit/ci-env-setup.sh
#
# Behavior:
#  - Ensures DATABASE_URL is set (defaults to local Postgres container).
#  - Exports AUDIT_SIGNING_KEY (so auditChain can sign in CI).
#  - If SIGNING_PROXY_URL not set, starts a local signer-proxy mock server on port 8081
#    using the included signerProxyMockServer.ts and exports SIGNING_PROXY_URL.
#  - Waits for Postgres readiness before returning.
#  - Prints exported variables for visibility.
#
# Notes:
#  - Intended for CI job steps or local developer convenience. Not for production use.
#  - If you want to use real KMS, set AUDIT_SIGNING_KMS_KEY_ID or SIGNING_PROXY_URL in the environment
#    before invoking this script and the script will not start the mock proxy.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${ROOT_DIR}/tmp"
mkdir -p "$LOG_DIR"

# Defaults (override by exporting in the environment beforehand)
: "${DATABASE_URL:=postgres://illuvrse:illuvrse_pass@localhost:5432/illuvrse_memory}"
: "${AUDIT_SIGNING_KEY:=test-ci-signing-key-please-change}"
: "${SIGNING_PROXY_PORT:=8081}"
: "${SIGNING_PROXY_API_KEY:=local-ci-key}"

export DATABASE_URL
export AUDIT_SIGNING_KEY

# If the environment already supplies AUDIT_SIGNING_KMS_KEY_ID or SIGNING_PROXY_URL, prefer those.
if [ -n "${AUDIT_SIGNING_KMS_KEY_ID:-}" ]; then
  echo "Using AUDIT_SIGNING_KMS_KEY_ID from environment (KMS signing)."
fi

if [ -n "${SIGNING_PROXY_URL:-}" ]; then
  echo "Using existing SIGNING_PROXY_URL=${SIGNING_PROXY_URL}"
else
  # Start local signing-proxy mock if not already running on port
  if nc -z localhost "${SIGNING_PROXY_PORT}" >/dev/null 2>&1; then
    echo "Signer proxy already listening on port ${SIGNING_PROXY_PORT}; reusing it."
    export SIGNING_PROXY_URL="http://localhost:${SIGNING_PROXY_PORT}"
  else
    echo "Starting mock signing proxy on port ${SIGNING_PROXY_PORT}..."
    # Start signerProxyMockServer.ts with ts-node in background
    # Redirect logs to tmp/signing-proxy.log
    # Use SIGNING_PROXY_API_KEY to require auth
    export SIGNING_PROXY_API_KEY
    nohup npx ts-node "${ROOT_DIR}/memory-layer/service/audit/signerProxyMockServer.ts" \
      > "${LOG_DIR}/signing-proxy.log" 2>&1 &
    PROXY_PID=$!
    # Wait up to 15s for the proxy to be reachable
    for i in {1..15}; do
      if nc -z localhost "${SIGNING_PROXY_PORT}" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if ! nc -z localhost "${SIGNING_PROXY_PORT}" >/dev/null 2>&1; then
      echo "Failed to start signing proxy; check ${LOG_DIR}/signing-proxy.log"
      exit 1
    fi
    export SIGNING_PROXY_URL="http://localhost:${SIGNING_PROXY_PORT}"
    echo "Started mock signing proxy (pid=${PROXY_PID}) at ${SIGNING_PROXY_URL}"
    # When script exits, do not kill the proxy: CI can let it run for the job duration.
  fi
fi

# Wait for Postgres to be ready (pg_isready)
echo "Waiting for Postgres at ${DATABASE_URL}..."
# parse host/port from DATABASE_URL
# default timeout loop
for i in {1..20}; do
  if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -d "${DATABASE_URL}" >/dev/null 2>&1; then
      echo "Postgres appears ready."
      break
    fi
  else
    # Fallback: try to connect via psql if available
    if command -v psql >/dev/null 2>&1; then
      if PGPASSWORD="${DATABASE_URL#*:*@*:*\/}" psql "${DATABASE_URL}" -c '\q' >/dev/null 2>&1; then
        echo "Postgres appears ready (psql)."
        break
      fi
    fi
  fi
  echo "Postgres not ready yet... (${i}/20)"; sleep 3
  if [ "${i}" -eq 20 ]; then
    echo "Timeout waiting for Postgres. Ensure the container/service is available at ${DATABASE_URL}"; exit 2
  fi
done

echo "CI env ready:"
echo "  DATABASE_URL=${DATABASE_URL}"
echo "  AUDIT_SIGNING_KEY=(hidden)"
echo "  SIGNING_PROXY_URL=${SIGNING_PROXY_URL:-<none>}"

# Dump proxy log tail for visibility
if [ -f "${LOG_DIR}/signing-proxy.log" ]; then
  echo "=== signing-proxy.log (tail) ==="
  tail -n 40 "${LOG_DIR}/signing-proxy.log" || true
  echo "=== end signing-proxy.log ==="
fi

echo "CI environment setup complete. Run your migration and tests now."

