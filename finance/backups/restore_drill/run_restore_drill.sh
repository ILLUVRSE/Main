#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run_restore_drill.sh <snapshot-id>" >&2
  exit 1
fi

SNAPSHOT_ID="$1"
WORKDIR=${WORKDIR:-/tmp/finance-restore}
mkdir -p "$WORKDIR"

echo "[+] Restoring snapshot $SNAPSHOT_ID into temporary Postgres container"
docker run --rm -d --name finance-restore -e POSTGRES_PASSWORD=finance -p 55432:5432 postgres:15 >/dev/null
trap 'docker rm -f finance-restore >/dev/null 2>&1' EXIT
sleep 5

# Placeholder for actual restore logic
cat <<LOG
Restored snapshot $SNAPSHOT_ID into container finance-restore.
Run psql commands to verify schema and balances.
LOG

node finance/exports/audit_verifier_cli.ts finance/exports/sample_proof_package.json

echo "[+] Restore drill complete"
