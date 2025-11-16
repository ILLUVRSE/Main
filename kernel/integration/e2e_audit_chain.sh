#!/usr/bin/env bash
# kernel/integration/e2e_audit_chain.sh
#
# End-to-end audit chain verification (dev-mode, KMS stubbed via local RSA key)
# - Spins up disposable Postgres
# - Applies agent-manager migrations
# - Generates a local RSA signer (dev stub for KMS)
# - Emits a chain of signed audit events that simulate the cross-service flow:
#   agent spawn -> eval ingest -> promotion -> allocation
# - Runs kernel/tools/audit-verify.js against the DB + signer registry
#
# Requirements: docker, node, and agent-manager deps installed (npm ci --prefix agent-manager).
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.."; pwd)"
MIGRATION_SQL="${ROOT_DIR}/agent-manager/db/migrations/0001_create_agent_manager_tables.sql"
SIGNERS_JSON="$(mktemp -t audit-signers.XXXX.json)"
POSTGRES_CONTAINER="audit_chain_pg"
POSTGRES_IMAGE="postgres:15"
POSTGRES_DB="audit_chain"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="postgrespw"
HOST_PG_PORT=5445

cleanup() {
  echo "[audit-e2e] Cleaning up..."
  if docker ps -a --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}\$"; then
    docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true
  fi
  rm -f "${ROOT_DIR}/tmp_rsa_priv.pem" "${ROOT_DIR}/tmp_rsa_pub.pem" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[audit-e2e] Starting Postgres container (${POSTGRES_IMAGE})..."
docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true

docker run -d --name "${POSTGRES_CONTAINER}" \
  -e POSTGRES_DB="${POSTGRES_DB}" \
  -e POSTGRES_USER="${POSTGRES_USER}" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -p "${HOST_PG_PORT}:5432" \
  -v "${ROOT_DIR}:/work" \
  "${POSTGRES_IMAGE}" >/dev/null

echo "[audit-e2e] Waiting for Postgres readiness..."
MAX_RETRIES=30
i=0
until docker exec "${POSTGRES_CONTAINER}" pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; do
  i=$((i+1))
  if [[ $i -gt $MAX_RETRIES ]]; then
    echo "[audit-e2e][ERROR] Postgres did not become ready in time"
    docker logs "${POSTGRES_CONTAINER}" || true
    exit 1
  fi
  sleep 1
done
echo "[audit-e2e] Postgres ready."

echo "[audit-e2e] Applying migrations..."
docker exec -i "${POSTGRES_CONTAINER}" bash -lc "psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' -f /work/agent-manager/db/migrations/0001_create_agent_manager_tables.sql" >/dev/null
echo "[audit-e2e] Migrations applied."

echo "[audit-e2e] Generating dev RSA signer (KMS stub) ..."
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

cat > "${SIGNERS_JSON}" <<EOF
{
  "signers": [
    {
      "signerId": "audit-e2e-signer",
      "algorithm": "rsa-sha256",
      "publicKey": $(node -e "console.log(JSON.stringify(\`${PUB_KEY_CONTENT}\`))")
    }
  ]
}
EOF
echo "[audit-e2e] signers registry written to ${SIGNERS_JSON}"

export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${HOST_PG_PORT}/${POSTGRES_DB}"
export AUDIT_SIGNING_KEY_SOURCE="env"
export AUDIT_SIGNING_PRIVATE_KEY="${PRIV_KEY_CONTENT}"
export AUDIT_SIGNING_ALG="rsa-sha256"
export AUDIT_SIGNER_KID="audit-e2e-signer"
export NODE_ENV="development"
export REQUIRE_KMS="false"

echo "[audit-e2e] Emitting signed audit chain for cross-service flow..."
node <<'NODE'
const auditSigner = require('../../agent-manager/server/audit_signer');
const db = require('../../agent-manager/server/db');

async function main() {
  // Basic connectivity check
  await db.query('SELECT 1');

  const scenarios = [
    { actor: 'agent-manager', event: 'agent_spawned', payload: { agent_id: 'agent-1', profile: 'illuvrse' } },
    { actor: 'eval-engine', event: 'eval_ingested', payload: { agent_id: 'agent-1', eval_id: 'eval-1', score: 0.91 } },
    { actor: 'reasoning-graph', event: 'agent_promoted', payload: { agent_id: 'agent-1', new_level: 'trusted' } },
    { actor: 'sentinelnet', event: 'canary_passed', payload: { agent_id: 'agent-1', window: 'p50', rollback: false } },
    { actor: 'agent-manager', event: 'allocation_assigned', payload: { agent_id: 'agent-1', allocation: 'prod-slot-1' } },
  ];

  for (const s of scenarios) {
    const ev = await auditSigner.createSignedAuditEvent(s.actor, s.event, s.payload);
    if (!ev.signature) {
      throw new Error(`audit event for ${s.event} missing signature`);
    }
    console.log(`[emit] ${s.event} -> ${ev.id} prev=${ev.prev_hash || 'null'}`);
  }

  await db.close();
}

main().catch((err) => {
  console.error('[emit][ERROR]', err);
  process.exit(1);
});
NODE

echo "[audit-e2e] Running audit verification..."
node "${ROOT_DIR}/kernel/tools/audit-verify.js" \
  --database-url "${DATABASE_URL}" \
  --signers "${SIGNERS_JSON}" \
  --limit 50

echo "[audit-e2e] Success: audit chain verified."
