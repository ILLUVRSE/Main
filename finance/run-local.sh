#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.."; pwd)"
FINANCE_DIR="$REPO_ROOT/finance"
PID_FILE="/tmp/finance-run-local.pid"
POSTGRES_MARKER="/tmp/finance-run-local.postgres"
FINANCE_MOCK_LOG="/tmp/finance-mock.log"
PORT="${PORT:-8050}"
START_POSTGRES="${START_POSTGRES:-true}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:15-alpine}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-finance_dev_db}"
POSTGRES_DB="${POSTGRES_DB:-finance_dev}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5440}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"

START_MINIO="${START_MINIO:-false}"
MINIO_IMAGE="${MINIO_IMAGE:-minio/minio:latest}"
MINIO_CONTAINER="${MINIO_CONTAINER:-finance_minio}"
MINIO_PORT="${MINIO_PORT:-9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minio}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minio123}"
MINIO_DATA_DIR="${MINIO_DATA_DIR:-$REPO_ROOT/finance/.minio-data}"
MINIO_MARKER="/tmp/finance-run-local.minio"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-}"
S3_SECRET="${S3_SECRET:-}"

MOCK_SIGNING_PROXY="${MOCK_SIGNING_PROXY:-false}"
SIGNING_PROXY_PORT="${SIGNING_PROXY_PORT:-9100}"
SIGNING_PROXY_PID_FILE="/tmp/finance-signing-proxy.pid"
SIGNING_PROXY_LOG="/tmp/finance-signing-proxy.log"
START_FINANCE_MOCK="${START_FINANCE_MOCK:-true}"

if [ -z "${S3_ENDPOINT:-}" ] && ! is_true "$START_MINIO"; then
  START_MINIO=true
fi

is_true() {
  case "$1" in
    true|TRUE|1|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

stop_postgres() {
  if [ -f "$POSTGRES_MARKER" ]; then
    local marker action container
    marker="$(cat "$POSTGRES_MARKER")"
    action="${marker%%:*}"
    container="${marker#*:}"
    if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
      if [ "$action" = "created" ]; then
        echo "[finance/run-local] removing docker container ${container}"
        docker rm -f "$container" >/dev/null 2>&1 || true
      else
        echo "[finance/run-local] stopping docker container ${container}"
        docker stop "$container" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$POSTGRES_MARKER"
  fi
}

stop_minio() {
  if [ -f "$MINIO_MARKER" ]; then
    local container
    container="$(cat "$MINIO_MARKER")"
    if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
      echo "[finance/run-local] removing MinIO container ${container}"
      docker rm -f "$container" >/dev/null 2>&1 || true
    fi
    rm -f "$MINIO_MARKER"
  fi
}

stop_mock() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "[finance/run-local] stopping finance mock pid ${pid}"
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
  fi
}

stop_signing_proxy() {
  if [ -f "$SIGNING_PROXY_PID_FILE" ]; then
    local pid
    pid="$(cat "$SIGNING_PROXY_PID_FILE")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "[finance/run-local] stopping signing proxy pid ${pid}"
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$SIGNING_PROXY_PID_FILE"
  fi
}

start_minio() {
  if ! is_true "$START_MINIO"; then
    if [ -n "${S3_ENDPOINT:-}" ]; then
      echo "[finance/run-local] Using provided S3_ENDPOINT=${S3_ENDPOINT}"
    fi
    return
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "[finance/run-local][WARN] docker not available; cannot start MinIO" >&2
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "^${MINIO_CONTAINER}$"; then
    docker rm -f "${MINIO_CONTAINER}" >/dev/null 2>&1 || true
  fi
  mkdir -p "${MINIO_DATA_DIR}"
  echo "[finance/run-local] starting MinIO (${MINIO_IMAGE}) on port ${MINIO_PORT}"
  docker run -d --name "${MINIO_CONTAINER}" \
    -e MINIO_ROOT_USER="${MINIO_ACCESS_KEY}" \
    -e MINIO_ROOT_PASSWORD="${MINIO_SECRET_KEY}" \
    -p "${MINIO_PORT}:9000" \
    -v "${MINIO_DATA_DIR}:/data" \
    "${MINIO_IMAGE}" server /data >/dev/null
  echo "${MINIO_CONTAINER}" > "${MINIO_MARKER}"
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${MINIO_PORT}/minio/health/live" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  export S3_ENDPOINT="http://127.0.0.1:${MINIO_PORT}"
  export S3_ACCESS_KEY="${S3_ACCESS_KEY:-$MINIO_ACCESS_KEY}"
  export S3_SECRET="${S3_SECRET:-$MINIO_SECRET_KEY}"
  echo "[finance/run-local] MinIO ready (S3_ENDPOINT=${S3_ENDPOINT})"
}

start_signing_proxy() {
  if ! is_true "$MOCK_SIGNING_PROXY"; then
    return
  }
  local script="${REPO_ROOT}/kernel/mock/signingProxyMock.js"
  if [ ! -f "$script" ]; then
    echo "[finance/run-local][WARN] signing proxy mock not found at ${script}"
    return
  fi
  if [ -f "$SIGNING_PROXY_PID_FILE" ]; then
    local pid
    pid="$(cat "$SIGNING_PROXY_PID_FILE")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "[finance/run-local] signing proxy already running (pid ${pid})"
      return
    else
      rm -f "$SIGNING_PROXY_PID_FILE"
    fi
  fi
  echo "[finance/run-local] starting signing proxy mock on port ${SIGNING_PROXY_PORT}"
  SIGNING_PROXY_HOST=127.0.0.1 SIGNING_PROXY_PORT="${SIGNING_PROXY_PORT}" node "$script" > "${SIGNING_PROXY_LOG}" 2>&1 &
  echo $! > "$SIGNING_PROXY_PID_FILE"
  export SIGNING_PROXY_URL="${SIGNING_PROXY_URL:-http://127.0.0.1:${SIGNING_PROXY_PORT}}"
  echo "[finance/run-local] SIGNING_PROXY_URL=${SIGNING_PROXY_URL}"
}

if [[ "${1:-}" == "teardown" ]]; then
  stop_mock
  stop_postgres
  stop_minio
  stop_signing_proxy
  echo "[finance/run-local] teardown complete"
  exit 0
fi

start_postgres() {
  if ! is_true "$START_POSTGRES"; then
    echo "[finance/run-local] START_POSTGRES not set; skipping Postgres container"
    return
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "[finance/run-local][WARN] docker not available; cannot start Postgres"
    return
  fi
  local marker_action=""
  if docker ps -a --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
    if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
      echo "[finance/run-local] Postgres container ${POSTGRES_CONTAINER} already running"
    else
      echo "[finance/run-local] starting existing container ${POSTGRES_CONTAINER}"
      docker start "$POSTGRES_CONTAINER" >/dev/null
      marker_action="started"
    fi
  else
    echo "[finance/run-local] launching Postgres container ${POSTGRES_CONTAINER} (${POSTGRES_IMAGE})"
    docker run -d --name "$POSTGRES_CONTAINER" \
      -e POSTGRES_DB="$POSTGRES_DB" \
      -e POSTGRES_USER="$POSTGRES_USER" \
      -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      -p "${POSTGRES_PORT}:5432" \
      "$POSTGRES_IMAGE" >/dev/null
    marker_action="created"
  fi
  if [ -n "$marker_action" ]; then
    echo "${marker_action}:${POSTGRES_CONTAINER}" > "$POSTGRES_MARKER"
  else
    rm -f "$POSTGRES_MARKER" 2>/dev/null || true
  fi
  echo "[finance/run-local] waiting for Postgres on port ${POSTGRES_PORT}"
  local ready=0
  for i in $(seq 1 30); do
    if docker exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
      echo "[finance/run-local] Postgres is ready"
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "[finance/run-local][WARN] Postgres did not report ready within timeout; continuing"
  fi
}

start_mock() {
  if ! is_true "$START_FINANCE_MOCK"; then
    return
  }
  if [ ! -f "$FINANCE_DIR/mock/financeMockServer.js" ]; then
    echo "[finance/run-local][ERROR] finance mock missing at finance/mock/financeMockServer.js"
    exit 1
  fi
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "[finance/run-local] finance mock already running (pid $pid)"
      return
    else
      rm -f "$PID_FILE"
    fi
  fi
  mkdir -p "$(dirname "$FINANCE_MOCK_LOG")"
  (
    cd "$FINANCE_DIR/mock"
    PORT="$PORT" \
    S3_ENDPOINT="${S3_ENDPOINT:-}" \
    SIGNING_PROXY_URL="${SIGNING_PROXY_URL:-}" \
    node financeMockServer.js > "$FINANCE_MOCK_LOG" 2>&1 & echo $! > "$PID_FILE"
  )
  local pid
  pid="$(cat "$PID_FILE")"
  echo "[finance/run-local] finance mock listening on http://127.0.0.1:${PORT} (pid ${pid})"
}

start_postgres
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
fi
start_minio
start_signing_proxy
start_mock

cat <<MSG
[finance/run-local] Ready.
[finance/run-local] Postgres URL: ${DATABASE_URL}
[finance/run-local] FINANCE_API_URL="http://127.0.0.1:${PORT}"
[finance/run-local] S3_ENDPOINT=${S3_ENDPOINT:-"(not started)"}
[finance/run-local] SIGNING_PROXY_URL=${SIGNING_PROXY_URL:-"(not started)"}
[finance/run-local] Mock log: ${FINANCE_MOCK_LOG}
[finance/run-local] Teardown when finished: ./finance/run-local.sh teardown
MSG
