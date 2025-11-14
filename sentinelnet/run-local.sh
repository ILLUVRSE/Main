#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "Starting SentinelNet local environment..."

# 1) Ensure .env exists
if [ ! -f .env ]; then
  echo "No .env found — creating .env from .env.example (if present)"
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example. Edit it as needed and re-run this script."
  else
    cat > .env <<'EOF'
NODE_ENV=development
SENTINEL_PORT=7602
DEV_SKIP_MTLS=true
SENTINEL_DB_URL=postgres://postgres:password@localhost:5432/sentinel_db
KERNEL_AUDIT_URL=http://127.0.0.1:7602
EOF
    echo "Wrote a default .env. Edit variables as needed."
  fi
fi

# 2) Start Postgres (docker) if SENTINEL_DB_URL points to localhost/postgres and the container is not running.
#    This is a quick convenience; if you already have a DB, skip this step manually.
source .env
if echo "$SENTINEL_DB_URL" | grep -qE 'localhost|127.0.0.1'; then
  # check docker
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not found — ensure Postgres is running and SENTINEL_DB_URL is reachable."
  else
    CONTAINER_NAME="sentinel-postgres"
    if [ "$(docker ps -q -f name=${CONTAINER_NAME})" = "" ]; then
      if [ "$(docker ps -aq -f name=${CONTAINER_NAME})" != "" ]; then
        echo "Starting existing container ${CONTAINER_NAME}..."
        docker start ${CONTAINER_NAME}
      else
        echo "Creating and starting Postgres container '${CONTAINER_NAME}'..."
        docker run --name ${CONTAINER_NAME} -e POSTGRES_PASSWORD=password -e POSTGRES_DB=sentinel_db -p 5432:5432 -d postgres:15
        echo "Waiting for Postgres to accept connections..."
        sleep 3
      fi
    else
      echo "Postgres container ${CONTAINER_NAME} already running."
    fi
  fi
else
  echo "SENTINEL_DB_URL does not point to localhost; assuming external DB is managed."
fi

# 3) Install deps
if [ ! -d node_modules ]; then
  echo "Installing npm dependencies..."
  npm ci
fi

# 4) Run migrations
echo "Running DB migrations..."
npm run migrate

# 5) Start Kernel mock (background) for audit/multisig endpoints
KERNEL_MOCK_PORT="${KERNEL_MOCK_PORT:-7802}"
export KERNEL_AUDIT_URL="http://127.0.0.1:${KERNEL_MOCK_PORT}"
echo "Starting Kernel mock on ${KERNEL_AUDIT_URL}..."
KERNEL_MOCK_LOG="${ROOT_DIR}/kernel-mock.log"
npm run kernel:mock >"${KERNEL_MOCK_LOG}" 2>&1 &
KERNEL_MOCK_PID=$!
trap 'kill ${KERNEL_MOCK_PID} >/dev/null 2>&1 || true' EXIT

# Wait for mock to become healthy
echo "Waiting for Kernel mock to become healthy..."
for i in {1..30}; do
  if curl -fsS "${KERNEL_AUDIT_URL}/health" >/dev/null 2>&1; then
    echo "Kernel mock is up."
    break
  fi
  sleep 1
done

# 6) Run SentinelNet test suite (unit + integration)
echo "Running SentinelNet test suite..."
npm test

echo "All tests passed. Kernel mock logs located at ${KERNEL_MOCK_LOG}."
echo "To run the dev server afterwards: npm run dev"
