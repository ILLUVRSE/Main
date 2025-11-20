#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.."; pwd)"
FINANCE_DIR="$REPO_ROOT/finance"
PID_FILE="/tmp/finance-run-local.pid"
POSTGRES_MARKER="/tmp/finance-run-local.postgres"
FINANCE_MOCK_LOG="/tmp/finance-mock.log"
PORT="${PORT:-8050}"
START_POSTGRES="${START_POSTGRES:-false}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:15-alpine}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-finance_dev_db}"
POSTGRES_DB="${POSTGRES_DB:-finance_dev}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5440}"

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

if [[ "${1:-}" == "teardown" ]]; then
  stop_mock
  stop_postgres
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
  (cd "$FINANCE_DIR/mock" && PORT="$PORT" node financeMockServer.js > "$FINANCE_MOCK_LOG" 2>&1 & echo $! > "$PID_FILE")
  local pid
  pid="$(cat "$PID_FILE")"
  echo "[finance/run-local] finance mock listening on http://127.0.0.1:${PORT} (pid ${pid})"
}

start_postgres
start_mock

cat <<MSG
[finance/run-local] Ready.
[finance/run-local] Export FINANCE_API_URL="http://127.0.0.1:${PORT}" for services that call Finance.
[finance/run-local] Mock log: ${FINANCE_MOCK_LOG}
[finance/run-local] Teardown when finished: ./finance/run-local.sh teardown
MSG
