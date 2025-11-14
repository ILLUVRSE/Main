#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.postgres.yml"
RUN_TESTS="${RUN_TESTS:-0}"
KEEP_ALIVE="${KEEP_ALIVE:-0}"
HEADLESS_MODE="${HEADLESS_MODE:-${ARTIFACT_PUBLISHER_DISABLE_LISTENER:-0}}"

if [[ "${HEADLESS_MODE}" == "1" ]]; then
  export ARTIFACT_PUBLISHER_DISABLE_LISTENER=1
fi

cd "${SCRIPT_DIR}"

function log() {
  echo "[run-local] $*"
}

function has_docker() {
  command -v docker >/dev/null 2>&1
}

function compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  else
    echo "docker-compose"
  fi
}

POSTGRES_STARTED=0
KERNEL_PID=""
SERVER_PID=""

function cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    log "stopping dev server (${SERVER_PID})"
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${KERNEL_PID}" ]]; then
    log "stopping kernel mock (${KERNEL_PID})"
    kill "${KERNEL_PID}" >/dev/null 2>&1 || true
  fi

  if [[ "${POSTGRES_STARTED}" == "1" ]]; then
    log "stopping postgres container"
    $(compose_cmd) -f "${COMPOSE_FILE}" down >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

if has_docker; then
  log "starting postgres via docker compose"
  if $(compose_cmd) -f "${COMPOSE_FILE}" up -d postgres; then
    POSTGRES_STARTED=1
  else
    log "docker compose unavailable, continuing without postgres"
  fi
else
  log "docker not found, skipping postgres startup"
fi

log "installing dependencies if needed"
if [[ ! -d node_modules ]]; then
  npm install
fi

log "running migrations"
npm run migrate >/dev/null

log "building server"
npm run build >/dev/null

log "starting kernel mock on :6050"
node mock/kernelMockServer.js >/tmp/kernel-mock.log 2>&1 &
KERNEL_PID=$!
sleep 1

if [[ "${HEADLESS_MODE}" == "1" ]]; then
  log "headless mode enabled – skipping server start"
else
  log "starting artifact publisher server"
  node dist/index.js >/tmp/artifact-publisher.log 2>&1 &
  SERVER_PID=$!
  sleep 1
fi

if [[ "${RUN_TESTS}" == "1" ]]; then
  log "executing integration tests"
  npx vitest run test/e2e
  npx vitest run test/unit/sandboxRunner.test.ts
fi

if [[ "${KEEP_ALIVE}" == "1" ]]; then
  log "server is running (kernel pid ${KERNEL_PID}, app pid ${SERVER_PID})"
  log "press Ctrl+C to stop"
  wait
else
  log "services validated. Tail logs via: tail -f /tmp/artifact-publisher.log"
fi
