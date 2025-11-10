#!/usr/bin/env bash
# kernel/integration/e2e_agent_manager_sign_and_audit.sh
#
# End-to-end smoke test:
#  - Starts a temporary Postgres container
#  - Runs agent-manager migrations
#  - Generates RSA keypair and configures the agent-manager to sign audit events
#  - Starts agent-manager (dev)
#  - Calls /api/v1/agent/spawn to generate a signed audit event
#  - Runs kernel/tools/audit-verify.js to verify the audit chain
#
# Requirements:
#  - docker available (for Postgres)
#  - node (to run agent-manager and generate keys)
#  - psql inside the Postgres container (we use docker exec to run psql)
#  - jq (optional, used to extract JSON values)
#
# Usage:
#   ./kernel/integration/e2e_agent_manager_sign_and_audit.sh
#
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.."; pwd)"
MIGRATION_SQL="${ROOT_DIR}/agent-manager/db/migrations/0001_create_agent_manager_tables.sql"
SIGNERS_JSON="${ROOT_DIR}/kernel/tools/signers.json"
POSTGRES_CONTAINER="agent_manager_test_db"
POSTGRES_IMAGE="postgres:15"
POSTGRES_DB="am_test"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="postgrespw"
HOST_PG_PORT=5433
AGENT_MANAGER_PORT=5176
AGENT_MANAGER_LOG="agent_manager_e2e.log"

cleanup() {
  echo "[e2e] Cleaning up..."
  if [[ -n "${AGENT_MANAGER_PID:-}" ]]; then
    echo "[e2e] Killing agent-manager pid ${AGENT_MANAGER_PID}..."
    kill "${AGENT_MANAGER_PID}" 2>/dev/null || true
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}\$"; then
    echo "[e2e] Removing container ${POSTGRES_CONTAINER}..."
    docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true
  fi
  rm -f "${ROOT_DIR}/tmp_rsa_priv.pem" "${ROOT_DIR}/tmp_rsa_pub.pem" "${SIGNERS_JSON}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[e2e] Starting Postgres container (${POSTGRES_IMAGE})..."
# Remove any previous container with same name
docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true

docker run -d --name "${POSTGRES_CONTAINER}" \
  -e POSTGRES_DB="${POSTGRES_DB}" \
  -e POSTGRES_USER="${POSTGRES_USER}" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -p "${HOST_PG_PORT}:5432" \
  -v "${ROOT_DIR}:/work" \
  "${POSTGRES_IMAGE}" >/dev/null

echo "[e2e] Waiting for Postgres to accept connections..."
# Wait for postgres to be ready (try psql inside container)
MAX_RETRIES=30
i=0
until docker exec "${POSTGRES_CONTAINER}" pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; do
  i=$((i+1))
  if [[ $i -gt $MAX_RETRIES ]]; then
    echo "[e2e][ERROR] Postgres did not become ready in time"
    docker logs "${POSTGRES_CONTAINER}" || true
    exit 1
  fi
  sleep 1
done
echo "[e2e] Postgres is ready."

# Run migrations to create required tables
echo "[e2e] Applying migrations..."
docker exec -i "${POSTGRES_CONTAINER}" bash -lc "psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' -f /work/agent-manager/db/migrations/0001_create_agent_manager_tables.sql" >/dev/null
echo "[e2e] Migrations applied."

# Generate RSA keypair (Node) and write to files
echo "[e2e] Generating RSA key pair..."
node -e "
const crypto = require('crypto');
const fs = require('fs');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
});
fs.writeFileSync(process.cwd() + '/tmp_rsa_priv.pem', privateKey);
fs.writeFileSync(process.cwd() + '/tmp_rsa_pub.pem', publicKey);
console.log('ok');
" >/dev/null

PRIV_KEY_CONTENT="$(cat "${ROOT_DIR}/tmp_rsa_priv.pem")"
PUB_KEY_CONTENT="$(sed -n '1,200p' "${ROOT_DIR}/tmp_rsa_pub.pem")"

# Create signers.json for audit-verify with PEM public key
cat > "${SIGNERS_JSON}" <<EOF
{
  "signers": [
    {
      "signerId": "integration-rsa-test",
      "algorithm": "rsa-sha256",
      "publicKey": $(jq -Rs . <<< "$PUB_KEY_CONTENT")
    }
  ]
}
EOF

echo "[e2e] signers.json written to ${SIGNERS_JSON}"

# Start agent-manager in background, with DATABASE_URL pointing to our test Postgres.
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${HOST_PG_PORT}/${POSTGRES_DB}"
export AUDIT_SIGNING_KEY_SOURCE="env"
# Put private key into env var (be careful in CI!)
export AUDIT_SIGNING_PRIVATE_KEY="${PRIV_KEY_CONTENT}"
export AUDIT_SIGNING_ALG="rsa-sha256"
export AUDIT_SIGNER_KID="integration-rsa-test"
export PORT="${AGENT_MANAGER_PORT}"

echo "[e2e] Starting agent-manager (logs => ${AGENT_MANAGER_LOG})..."
# Run in repo root so require paths stay correct
nohup node "${ROOT_DIR}/agent-manager/server/index.js" > "${AGENT_MANAGER_LOG}" 2>&1 &
AGENT_MANAGER_PID=$!
sleep 1

# Wait for the server to be healthy
echo "[e2e] Waiting for agent-manager to be ready on port ${AGENT_MANAGER_PORT}..."
MAX_RETRIES=30
i=0
until curl -sSf "http://localhost:${AGENT_MANAGER_PORT}/health" >/dev/null 2>&1; do
  i=$((i+1))
  if [[ $i -gt $MAX_RETRIES ]]; then
    echo "[e2e][ERROR] agent-manager did not respond in time; tailing logs:"
    tail -n +1 "${AGENT_MANAGER_LOG}" || true
    exit 1
  fi
  sleep 1
done
echo "[e2e] agent-manager is healthy."

# Create an agent (this will emit & persist a signed audit event)
echo "[e2e] Creating an agent via /api/v1/agent/spawn..."
SPAWN_RESP=$(curl -sSf -X POST "http://localhost:${AGENT_MANAGER_PORT}/api/v1/agent/spawn" \
  -H "Content-Type: application/json" \
  -d '{"agent_config": {"name": "e2e-agent", "profile": "dev", "metadata": {"owner": "e2e-test"}}}' \
) || { echo "[e2e][ERROR] Failed to spawn agent"; tail -n 100 "${AGENT_MANAGER_LOG}"; exit 1; }

echo "[e2e] Spawn response: $SPAWN_RESP"

# Allow a moment for DB write
sleep 1

# Run audit-verify against test DB and the signers file
echo "[e2e] Running audit verification..."
NODE_CMD="node ${ROOT_DIR}/kernel/tools/audit-verify.js -d \"postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${HOST_PG_PORT}/${POSTGRES_DB}\" -s \"${SIGNERS_JSON}\""
eval ${NODE_CMD} || {
  echo "[e2e][ERROR] audit-verify failed. agent-manager logs (last 200 lines):"
  tail -n 200 "${AGENT_MANAGER_LOG}" || true
  exit 1
}

echo "[e2e] Audit verification succeeded."

# Done — cleanup will run via trap
exit 0

