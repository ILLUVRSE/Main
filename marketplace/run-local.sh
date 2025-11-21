#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
cd "$ROOT_DIR"

# Configurable envs (override on command line or export before invoking)
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:15}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-marketplace_dev_db}
POSTGRES_DB=${POSTGRES_DB:-marketplace_dev}
POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
POSTGRES_HOST_PORT=${POSTGRES_HOST_PORT:-5432}

MINIO_IMAGE=${MINIO_IMAGE:-minio/minio:latest}
MINIO_CONTAINER=${MINIO_CONTAINER:-marketplace_minio}
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY:-minio}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY:-minio123}
MINIO_HOST_PORT=${MINIO_HOST_PORT:-9000}

MARKETPLACE_PORT=${MARKETPLACE_PORT:-3000}
MARKETPLACE_LOG=/tmp/marketplace_run_local.log
PREVIEW_SANDBOX_PORT=${PREVIEW_SANDBOX_PORT:-8081}
PREVIEW_SANDBOX_LOG=/tmp/preview-sandbox.log

KERNEL_MOCK_CMD=${KERNEL_MOCK_CMD:-"node ./kernel/mock/kernelMockServer.js"}
FINANCE_MOCK_CMD=${FINANCE_MOCK_CMD:-"node ./finance/mock/financeMockServer.js"}
SIGNER_MOCK_CMD=${SIGNER_MOCK_CMD:-"node ./marketplace/mocks/signerMock.js"}

KEEP_ALIVE=${KEEP_ALIVE:-0}
RUN_TESTS=${RUN_TESTS:-0}

cleanup() {
  echo "[run-local] cleaning up..."
  if [ -n "${MARKETPLACE_PID:-}" ]; then
    echo "[run-local] killing marketplace pid ${MARKETPLACE_PID}"
    kill "${MARKETPLACE_PID}" 2>/dev/null || true
  fi
  if [ -n "${KERNEL_MOCK_PID:-}" ]; then
    kill "${KERNEL_MOCK_PID}" 2>/dev/null || true
  fi
  if [ -n "${FINANCE_MOCK_PID:-}" ]; then
    kill "${FINANCE_MOCK_PID}" 2>/dev/null || true
  fi
  if [ -n "${SIGNER_MOCK_PID:-}" ]; then
    kill "${SIGNER_MOCK_PID}" 2>/dev/null || true
  fi
  if [ -n "${PREVIEW_SANDBOX_PID:-}" ]; then
    kill "${PREVIEW_SANDBOX_PID}" 2>/dev/null || true
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}\$"; then
    echo "[run-local] stopping docker container ${POSTGRES_CONTAINER}..."
    docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "^${MINIO_CONTAINER}\$"; then
    echo "[run-local] stopping docker container ${MINIO_CONTAINER}..."
    docker rm -f "${MINIO_CONTAINER}" >/dev/null 2>&1 || true
  fi
  echo "[run-local] done."
}
trap cleanup EXIT

echo "[run-local] Starting local dev environment for Marketplace"
echo "[run-local] Root dir: $ROOT_DIR"

# Start Postgres container
if docker ps -a --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}\$"; then
  echo "[run-local] Removing existing container ${POSTGRES_CONTAINER}"
  docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true
fi

echo "[run-local] Starting Postgres (${POSTGRES_IMAGE}) as ${POSTGRES_CONTAINER}..."
docker run -d --name "${POSTGRES_CONTAINER}" \
  -e POSTGRES_DB="${POSTGRES_DB}" \
  -e POSTGRES_USER="${POSTGRES_USER}" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -p "${POSTGRES_HOST_PORT}:5432" \
  "${POSTGRES_IMAGE}" >/dev/null

echo "[run-local] Waiting for Postgres to accept connections..."
MAX_RETRIES=30
i=0
until docker exec "${POSTGRES_CONTAINER}" pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; do
  i=$((i+1))
  if [[ $i -gt $MAX_RETRIES ]]; then
    echo "[run-local][ERROR] Postgres did not become ready in time"
    docker logs "${POSTGRES_CONTAINER}" || true
    exit 1
  fi
  sleep 1
done
echo "[run-local] Postgres is ready."

# Create marketplace DB if it wasn't created by env
# (Postgres creates DB from POSTGRES_DB env automatically)

# Start MinIO container
if docker ps -a --format '{{.Names}}' | grep -q "^${MINIO_CONTAINER}\$"; then
  echo "[run-local] Removing existing container ${MINIO_CONTAINER}"
  docker rm -f "${MINIO_CONTAINER}" >/dev/null 2>&1 || true
fi

echo "[run-local] Starting MinIO (${MINIO_IMAGE}) as ${MINIO_CONTAINER}..."
docker run -d --name "${MINIO_CONTAINER}" -p "${MINIO_HOST_PORT}:9000" \
  -e MINIO_ROOT_USER="${MINIO_ACCESS_KEY}" \
  -e MINIO_ROOT_PASSWORD="${MINIO_SECRET_KEY}" \
  -v "${ROOT_DIR}/.minio-data:/data" \
  "${MINIO_IMAGE}" server /data >/dev/null

echo "[run-local] Waiting for MinIO to accept connections..."
i=0
until curl -sS "http://127.0.0.1:${MINIO_HOST_PORT}/minio/health/live" >/dev/null 2>&1; do
  i=$((i+1))
  if [[ $i -gt 30 ]]; then
    echo "[run-local][WARN] MinIO did not report healthy; continuing anyway..."
    break
  fi
  sleep 1
done
echo "[run-local] MinIO started."

# Create S3 buckets (audit & artifacts) using mc if available or aws cli
if command -v mc >/dev/null 2>&1; then
  echo "[run-local] Configuring MinIO (mc)..."
  mc alias set local "http://127.0.0.1:${MINIO_HOST_PORT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null 2>&1 || true
  mc mb -p local/marketplace-artifacts >/dev/null 2>&1 || true
  mc mb -p local/marketplace-audit >/dev/null 2>&1 || true
else
  echo "[run-local] 'mc' (MinIO client) not found. Please create buckets manually:"
  echo "  Console: http://127.0.0.1:${MINIO_HOST_PORT}  (access: ${MINIO_ACCESS_KEY})"
fi

# Optional: run kernel mock, finance mock, signer mock if present
echo "[run-local] Starting optional mocks (Kernel / Finance / Signer) if present..."

# Kernel mock
if [ -f "${ROOT_DIR}/kernel/mock/kernelMockServer.js" ]; then
  echo "[run-local] Starting Kernel mock..."
  (cd "${ROOT_DIR}/kernel/mock" && node kernelMockServer.js > /tmp/kernel-mock.log 2>&1 & echo $! > /tmp/kernel-mock.pid)
  KERNEL_MOCK_PID=$(cat /tmp/kernel-mock.pid)
  echo "[run-local] Kernel mock pid: ${KERNEL_MOCK_PID}"
else
  echo "[run-local] Kernel mock not found at kernel/mock/kernelMockServer.js - ensure Kernel mock exists or set KERNEL_API_URL to a running Kernel."
fi

# Finance mock
if [ -f "${ROOT_DIR}/finance/mock/financeMockServer.js" ]; then
  echo "[run-local] Starting Finance mock..."
  (cd "${ROOT_DIR}/finance/mock" && node financeMockServer.js > /tmp/finance-mock.log 2>&1 & echo $! > /tmp/finance-mock.pid)
  FINANCE_MOCK_PID=$(cat /tmp/finance-mock.pid)
  echo "[run-local] Finance mock pid: ${FINANCE_MOCK_PID}"
else
  echo "[run-local] Finance mock not found at finance/mock/financeMockServer.js - configure FINANCE_API_URL if using a separate service."
fi

# Signer mock (optional)
if [ -f "${ROOT_DIR}/marketplace/mocks/signerMock.js" ]; then
  echo "[run-local] Starting Signer mock..."
  (cd "${ROOT_DIR}/marketplace/mocks" && node signerMock.js > /tmp/signer-mock.log 2>&1 & echo $! > /tmp/signer-mock.pid)
  SIGNER_MOCK_PID=$(cat /tmp/signer-mock.pid)
  echo "[run-local] Signer mock pid: ${SIGNER_MOCK_PID}"
else
  echo "[run-local] Signer mock not found at marketplace/mocks/signerMock.js - marketplace can use a dev signing key if configured."
fi

# Preview sandbox server
if [ -f "${ROOT_DIR}/marketplace/sandbox/previewServer.ts" ]; then
  echo "[run-local] Starting preview sandbox..."
  (
    cd "${ROOT_DIR}/marketplace"
    PREVIEW_PORT=${PREVIEW_SANDBOX_PORT} npx ts-node sandbox/previewServer.ts > "${PREVIEW_SANDBOX_LOG}" 2>&1 &
    echo $! > /tmp/preview-sandbox.pid
  )
  PREVIEW_SANDBOX_PID=$(cat /tmp/preview-sandbox.pid)
  echo "[run-local] Preview sandbox pid: ${PREVIEW_SANDBOX_PID} (ws://127.0.0.1:${PREVIEW_SANDBOX_PORT}/preview)"
else
  echo "[run-local] Preview sandbox not found - streaming previews will be disabled."
fi

# Apply migrations if present (search for migration script)
if [ -f "${ROOT_DIR}/marketplace/scripts/runMigrations.sh" ]; then
  echo "[run-local] Running marketplace migrations..."
  (cd "${ROOT_DIR}/marketplace" && ./scripts/runMigrations.sh "postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/${POSTGRES_DB}")
elif [ -d "${ROOT_DIR}/marketplace/sql/migrations" ]; then
  echo "[run-local] Applying SQL migrations via psql..."
  docker exec -i "${POSTGRES_CONTAINER}" bash -lc "psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' -f /work/marketplace/sql/migrations/0001_init.sql" 2>/dev/null || true
  # note: if you have more migrations, adapt this block.
else
  echo "[run-local] No migrations found for Marketplace - ensure DB schema is ready."
fi

# Start Marketplace server
echo "[run-local] Starting Marketplace server (npm run dev) - logs -> ${MARKETPLACE_LOG}"
# Allow marketplace to pick up env defaults pointing to local Postgres/MinIO and mocks
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/${POSTGRES_DB}"
export S3_ENDPOINT="http://127.0.0.1:${MINIO_HOST_PORT}"
export S3_ACCESS_KEY="${MINIO_ACCESS_KEY}"
export S3_SECRET="${MINIO_SECRET_KEY}"
export KERNEL_API_URL="${KERNEL_API_URL:-http://127.0.0.1:6050}"  # default Kernel mock URL if available
export FINANCE_API_URL="${FINANCE_API_URL:-http://127.0.0.1:8050}"
export SIGNING_PROXY_URL="${SIGNING_PROXY_URL:-http://127.0.0.1:7000}"
export AUDIT_SIGNING_KEY_SOURCE="${AUDIT_SIGNING_KEY_SOURCE:-env}"
export AUDIT_SIGNING_PRIVATE_KEY="${AUDIT_SIGNING_PRIVATE_KEY:-}" # developer can set for local
export RUN_LOCAL='1'

mkdir -p "$(dirname "${MARKETPLACE_LOG}")"
# start in background
(
  cd "${ROOT_DIR}/marketplace"
  # prefer `npm run dev` if available, else try `node server/index.js`
  if [ -f package.json ] && jq -e '.scripts | has("dev")' package.json >/dev/null 2>&1; then
    npm run dev > "${MARKETPLACE_LOG}" 2>&1 &
  elif [ -f server/index.js ]; then
    node server/index.js > "${MARKETPLACE_LOG}" 2>&1 &
  else
    echo "No dev entrypoint found in marketplace (package.json dev script or server/index.js). Please start the server manually." > "${MARKETPLACE_LOG}"
  fi
  echo $! > /tmp/marketplace.pid
)
MARKETPLACE_PID=$(cat /tmp/marketplace.pid)
echo "[run-local] Marketplace pid: ${MARKETPLACE_PID}"

# Wait for marketplace /health
echo "[run-local] Waiting for Marketplace to report healthy on port ${MARKETPLACE_PORT}..."
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${MARKETPLACE_PORT}/health" >/dev/null 2>&1; then
    echo "[run-local] Marketplace is healthy."
    break
  fi
  sleep 1
  echo "[run-local] waiting (${i}/40)..."
done

if [ "${RUN_TESTS}" = "1" ]; then
  echo "[run-local] RUN_TESTS=1: Running test suite..."
  # Run e2e tests if present
  if [ -f marketplace/package.json ] && jq -e '.scripts | has("test:e2e")' marketplace/package.json >/dev/null 2>&1; then
    (cd marketplace && npm run test:e2e) || true
  elif [ -d marketplace/test/e2e ]; then
    (cd marketplace && npx vitest run test/e2e --runInBand) || true
  else
    echo "[run-local] No e2e tests found under marketplace/test/e2e"
  fi
fi

echo "[run-local] Local environment started."
if [ "${KEEP_ALIVE}" = "1" ]; then
  echo "[run-local] KEEP_ALIVE=1: Keeping environment running. Press Ctrl+C to stop."
  # Tail logs for visibility
  tail -F "${MARKETPLACE_LOG}"
else
  echo "[run-local] To keep processes running, set KEEP_ALIVE=1 before invoking this script."
  echo "[run-local] To stop, run: ./marketplace/run-local.sh teardown OR kill the PIDs logged in /tmp/*.pid"
fi

# Provide friendly exit (cleanup trap will run)
exit 0
