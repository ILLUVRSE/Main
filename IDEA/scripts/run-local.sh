#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.."; pwd)/IDEA"
SERVICE_DIR="${ROOT_DIR}/service"

POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-idea_dev_db}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:15}
POSTGRES_PORT=${POSTGRES_PORT:-5544}
POSTGRES_DB=${POSTGRES_DB:-idea_dev}
POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}

MINIO_CONTAINER=${MINIO_CONTAINER:-idea_minio}
MINIO_IMAGE=${MINIO_IMAGE:-minio/minio:latest}
MINIO_PORT=${MINIO_PORT:-9100}
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY:-minio}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY:-minio123}
MINIO_BUCKET=${MINIO_BUCKET:-idea-packages}

SIGNING_PROXY_PORT=${SIGNING_PROXY_PORT:-9101}
KEEP_CONTAINERS=${KEEP_CONTAINERS:-0}
IDEA_LOG=${IDEA_LOG:-/tmp/idea-service.log}

cleanup() {
  if [[ "${KEEP_CONTAINERS}" == "1" ]]; then
    echo "[idea:run-local] KEEP_CONTAINERS=1, skipping cleanup."
    return
  fi
  echo "[idea:run-local] cleaning up..."
  [[ -n "${IDEA_PID:-}" ]] && kill "${IDEA_PID}" 2>/dev/null || true
  [[ -n "${SIGNING_PROXY_PID:-}" ]] && kill "${SIGNING_PROXY_PID}" 2>/dev/null || true
  docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true
  docker rm -f "${MINIO_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[idea:run-local] starting Postgres (${POSTGRES_IMAGE}) on port ${POSTGRES_PORT}"
docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true
docker run -d \
  --name "${POSTGRES_CONTAINER}" \
  -e POSTGRES_USER="${POSTGRES_USER}" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -e POSTGRES_DB="${POSTGRES_DB}" \
  -p "${POSTGRES_PORT}:5432" \
  "${POSTGRES_IMAGE}" >/dev/null

echo "[idea:run-local] waiting for Postgres..."
for i in {1..30}; do
  if docker exec "${POSTGRES_CONTAINER}" pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; then
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "[idea:run-local] Postgres failed to start"
    exit 1
  fi
  sleep 1
done

echo "[idea:run-local] starting MinIO (${MINIO_IMAGE}) on port ${MINIO_PORT}"
docker rm -f "${MINIO_CONTAINER}" >/dev/null 2>&1 || true
docker run -d \
  --name "${MINIO_CONTAINER}" \
  -e MINIO_ROOT_USER="${MINIO_ACCESS_KEY}" \
  -e MINIO_ROOT_PASSWORD="${MINIO_SECRET_KEY}" \
  -p "${MINIO_PORT}:9000" \
  -v "${ROOT_DIR}/.data/minio:/data" \
  "${MINIO_IMAGE}" server /data >/dev/null

echo "[idea:run-local] waiting for MinIO..."
for i in {1..30}; do
  if curl -s "http://127.0.0.1:${MINIO_PORT}/minio/health/live" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if command -v mc >/dev/null 2>&1; then
  mc alias set idea-local "http://127.0.0.1:${MINIO_PORT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null 2>&1 || true
  mc mb -p "idea-local/${MINIO_BUCKET}" >/dev/null 2>&1 || true
fi

echo "[idea:run-local] launching signing proxy mock on port ${SIGNING_PROXY_PORT}"
SIGNING_PROXY_HOST=127.0.0.1 SIGNING_PROXY_PORT="${SIGNING_PROXY_PORT}" \
  node "${ROOT_DIR}/../kernel/mock/signingProxyMock.js" >/tmp/idea-signing-proxy.log 2>&1 &
SIGNING_PROXY_PID=$!

export IDEA_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
export IDEA_S3_ENDPOINT="http://127.0.0.1:${MINIO_PORT}"
export IDEA_S3_ACCESS_KEY="${MINIO_ACCESS_KEY}"
export IDEA_S3_SECRET="${MINIO_SECRET_KEY}"
export IDEA_S3_BUCKET="${MINIO_BUCKET}"
export SIGNING_PROXY_URL="http://127.0.0.1:${SIGNING_PROXY_PORT}"
export REQUIRE_SIGNING_PROXY=true
export REQUIRE_MTLS=false
export AUTH_JWT_SECRET=${AUTH_JWT_SECRET:-"dev-secret"}

echo "[idea:run-local] running migrations..."
(cd "${SERVICE_DIR}" && npm run migrate)

echo "[idea:run-local] starting IDEA service (logs -> ${IDEA_LOG})"
(
  cd "${SERVICE_DIR}"
  npm run dev > "${IDEA_LOG}" 2>&1 &
  echo $! > /tmp/idea-service.pid
)
IDEA_PID=$(cat /tmp/idea-service.pid)

echo "[idea:run-local] service started on http://127.0.0.1:6060"
echo "  tail -f ${IDEA_LOG}"
wait "${IDEA_PID}"
