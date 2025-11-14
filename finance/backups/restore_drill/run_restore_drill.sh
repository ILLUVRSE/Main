#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: run_restore_drill.sh <backup-archive> <proof-package>" >&2
  exit 1
fi

BACKUP_ARCHIVE="$1"
PROOF_PACKAGE="$2"
CONTAINER="finance-restore-$$"
PG_PORT=${PG_PORT:-55432}
PG_USER=${PG_USER:-postgres}
PG_DB=${PG_DB:-finance}

echo "[+] Starting temporary Postgres container ($CONTAINER)"
docker run --rm -d --name "$CONTAINER" -e POSTGRES_PASSWORD=finance -e POSTGRES_DB="$PG_DB" -p "$PG_PORT":5432 postgres:15 >/dev/null
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1' EXIT

echo "[+] Waiting for Postgres"
for _ in {1..10}; do
  if docker exec "$CONTAINER" pg_isready >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "[+] Restoring backup from $BACKUP_ARCHIVE"
if [[ "$BACKUP_ARCHIVE" == *.sql ]]; then
  cat "$BACKUP_ARCHIVE" | docker exec -i "$CONTAINER" psql -U "$PG_USER" "$PG_DB"
else
  cat "$BACKUP_ARCHIVE" | docker exec -i "$CONTAINER" pg_restore -U "$PG_USER" -d "$PG_DB"
fi

echo "[+] Validating restored balances"
docker exec "$CONTAINER" psql -U "$PG_USER" "$PG_DB" -c "SELECT COUNT(*) AS journal_entries FROM journal_entries;"

echo "[+] Running audit verifier"
npx ts-node finance/exports/audit_verifier_cli.ts "$PROOF_PACKAGE"

echo "[+] Restore drill complete"
