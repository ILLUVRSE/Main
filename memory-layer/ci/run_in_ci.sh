#!/usr/bin/env bash
# memory-layer/ci/run_in_ci.sh
#
# CI helper for Memory Layer:
#  - run migrations
#  - start server in background (writes memory-layer-server.log)
#  - wait for /healthz to report ready
#  - run integration tests (Jest)
#  - capture logs on failure and always cleanup
#
# Usage (from repo root):
#   MEMORY_LAYER_PORT=4300 DATABASE_URL=... SIGNING_PROXY_URL=... ./memory-layer/ci/run_in_ci.sh
#
# Environment variables:
#   DATABASE_URL           (required) Postgres connection string for memory-layer
#   MEMORY_LAYER_PORT      (optional) defaults to 4300
#   NODE_ENV               (optional) defaults to test
#   REQUIRE_KMS            (optional) 'true' to enforce signer presence
#   SIGNING_PROXY_URL      (optional) URL for signing proxy (mock-kms)
#   MIGRATE_ON_START       (optional) 'true' to run migrations automatically (default: true for CI)
#   CI_TEST_CMD            (optional) command to run tests (default: ./node_modules/.bin/jest test/integration --runInBand)
set -euo pipefail

########## Configuration ##########
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MEMORY_DIR="${ROOT_DIR}/memory-layer"
LOG_FILE="${MEMORY_DIR}/memory-layer-server.log"
PID_FILE="${MEMORY_DIR}/memory-layer-server.pid"

MEMORY_LAYER_PORT="${MEMORY_LAYER_PORT:-4300}"
NODE_ENV="${NODE_ENV:-test}"
REQUIRE_KMS="${REQUIRE_KMS:-true}"
MIGRATE_ON_START="${MIGRATE_ON_START:-true}"
CI_TEST_CMD="${CI_TEST_CMD:-./node_modules/.bin/jest test/integration --runInBand}"

HEALTHZ_URL="http://localhost:${MEMORY_LAYER_PORT}/healthz"
READY_TIMEOUT_SECONDS=60
SLEEP_INTERVAL=2

########## Helpers ##########
err() {
  echo "[ERROR] $*" >&2
}

info() {
  echo "[INFO] $*"
}

dump_logs() {
  echo "---- BEGIN memory-layer-server.log ----"
  if [ -f "${LOG_FILE}" ]; then
    tail -n 500 "${LOG_FILE}" || true
  else
    echo "(no log file found)"
  fi
  echo "----  END  memory-layer-server.log ----"
}

cleanup() {
  rc=$?
  info "Cleaning up: stopping memory-layer server if running"
  if [ -f "${PID_FILE}" ]; then
    pid="$(cat "${PID_FILE}")"
    if kill -0 "${pid}" >/dev/null 2>&1; then
      info "Killing PID ${pid}"
      kill "${pid}" || true
      sleep 1
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
    rm -f "${PID_FILE}" || true
  fi
  # Always show logs if non-zero exit
  if [ "${rc}" -ne 0 ]; then
    dump_logs
  fi
  exit "${rc}"
}

trap cleanup EXIT INT TERM

########## Preconditions ##########
if [ -z "${DATABASE_URL:-}" ]; then
  err "DATABASE_URL is not set. Set DATABASE_URL before running this script."
  exit 2
fi

if [ ! -d "${MEMORY_DIR}" ]; then
  err "memory-layer directory not found at '${MEMORY_DIR}'. Run from repo root."
  exit 2
fi

cd "${MEMORY_DIR}"

info "Environment:
  DATABASE_URL=${DATABASE_URL}
  MEMORY_LAYER_PORT=${MEMORY_LAYER_PORT}
  NODE_ENV=${NODE_ENV}
  REQUIRE_KMS=${REQUIRE_KMS}
  MIGRATE_ON_START=${MIGRATE_ON_START}
  SIGNING_PROXY_URL=${SIGNING_PROXY_URL:-<not set>}
"

########## Step 1: install deps (if node_modules missing) ##########
if [ ! -d node_modules ]; then
  info "Installing memory-layer npm dependencies (npm ci)..."
  npm ci
fi

########## Step 2: build (if dist missing) ##########
if [ ! -d dist ]; then
  info "Building memory-layer (npm run memory-layer:build)..."
  npm run memory-layer:build
fi

########## Step 3: run migrations ##########
if [ "${MIGRATE_ON_START}" = "true" ]; then
  info "Running migrations..."
  # Prefer compiled JS migration runner if present
  if [ -f "./dist/memory-layer/scripts/runMigrations.js" ]; then
    node ./dist/memory-layer/scripts/runMigrations.js ./dist/memory-layer/sql/migrations
  else
    # fallback to ts-node if available
    if [ -x ./node_modules/.bin/ts-node ]; then
      ./node_modules/.bin/ts-node ./scripts/runMigrations.ts ./sql/migrations
    else
      err "Migration runner not found (dist or ts-node). Ensure migrations are runnable."
      exit 3
    fi
  fi
fi

########## Step 4: sanity check signer presence when REQUIRE_KMS=true ##########
if [ "${REQUIRE_KMS}" = "true" ]; then
  if [ -z "${AUDIT_SIGNING_KMS_KEY_ID:-}" ] && [ -z "${SIGNING_PROXY_URL:-}" ] && \
     [ -z "${AUDIT_SIGNING_KEY:-}" ] && [ -z "${AUDIT_SIGNING_PRIVATE_KEY:-}" ] && [ -z "${AUDIT_SIGNING_SECRET:-}" ]; then
    err "REQUIRE_KMS=true but no signer configured. Set SIGNING_PROXY_URL or AUDIT_SIGNING_KMS_KEY_ID or local key envs."
    exit 4
  fi
fi

########## Step 5: start the server in background ##########
# Choose runtime entry: compiled server first, fallback to ts-node start script.
info "Starting memory-layer server in background (logs -> ${LOG_FILE})"

# Ensure old logs/pid removed
rm -f "${LOG_FILE}" "${PID_FILE}" || true

if [ -f ./dist/memory-layer/service/server.js ]; then
  # start compiled server
  nohup node ./dist/memory-layer/service/server.js >> "${LOG_FILE}" 2>&1 &
  server_pid=$!
elif [ -x ./node_modules/.bin/ts-node ]; then
  nohup ./node_modules/.bin/ts-node ./service/server.ts >> "${LOG_FILE}" 2>&1 &
  server_pid=$!
else
  err "Cannot start server: compiled dist not found and ts-node missing."
  exit 5
fi

echo "${server_pid}" > "${PID_FILE}"
info "Launched server with PID ${server_pid}; waiting for /healthz (timeout ${READY_TIMEOUT_SECONDS}s)..."

########## Step 6: wait for /healthz ##########
i=0
while true; do
  if curl -sSf "${HEALTHZ_URL}" >/dev/null 2>&1; then
    # optionally check content for '"status": "ok"'
    body="$(curl -sS "${HEALTHZ_URL}" || true)"
    echo "[healthz] ${body}"
    if echo "${body}" | grep -q '"status": *"ok"' || echo "${body}" | grep -qi 'ready'; then
      info "Health check OK"
      break
    fi
  fi
  i=$((i + 1))
  if [ "${i}" -ge $((READY_TIMEOUT_SECONDS / SLEEP_INTERVAL)) ]; then
    err "Server did not become healthy within ${READY_TIMEOUT_SECONDS}s; dumping log"
    dump_logs
    exit 6
  fi
  sleep "${SLEEP_INTERVAL}"
done

########## Step 7: run integration tests ##########
info "Running integration tests: ${CI_TEST_CMD}"
set +e
# Run tests with the repo-local env
DATABASE_URL="${DATABASE_URL}" PORT="${MEMORY_LAYER_PORT}" NODE_ENV="${NODE_ENV}" REQUIRE_KMS="${REQUIRE_KMS}" SIGNING_PROXY_URL="${SIGNING_PROXY_URL:-}" ${CI_TEST_CMD}
tests_rc=$?
set -e

if [ "${tests_rc}" -ne 0 ]; then
  err "Integration tests failed (rc=${tests_rc})."
  dump_logs
  exit "${tests_rc}"
fi

info "Integration tests passed."

# Normal exit (cleanup will run via trap)
exit 0

