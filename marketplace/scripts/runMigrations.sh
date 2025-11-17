#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/sql/migrations"

usage() {
  cat <<EOF
Usage: $0 [DATABASE_URL]

Apply SQL migrations in ${MIGRATIONS_DIR} in sorted order.

If DATABASE_URL is omitted, this script uses the DATABASE_URL env var.

Example:
  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/marketplace ./scripts/runMigrations.sh
  or
  ./scripts/runMigrations.sh "postgres://postgres:postgres@127.0.0.1:5432/marketplace"
EOF
  exit 1
}

DB_URL="${1:-${DATABASE_URL:-}}"

if [ -z "${DB_URL}" ]; then
  echo "ERROR: DATABASE_URL not provided."
  usage
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required but not found in PATH. Install postgresql client tools."
  exit 2
fi

if [ ! -d "${MIGRATIONS_DIR}" ]; then
  echo "No migrations directory found at ${MIGRATIONS_DIR}; nothing to apply."
  exit 0
fi

echo "[migrate] Applying SQL migrations from ${MIGRATIONS_DIR} to ${DB_URL}"

# Export PGPASSWORD if DATABASE_URL contains a password? We rely on connection string or env for auth.
# Use psql -v ON_ERROR_STOP=1 so any SQL error fails the script.
set -o pipefail

# Find files and sort them. If none, exit happily.
mapfile -t files < <(ls -1 "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | sort || true)
if [ "${#files[@]}" -eq 0 ]; then
  echo "[migrate] No .sql files found in ${MIGRATIONS_DIR}; nothing to apply."
  exit 0
fi

for f in "${files[@]}"; do
  echo "[migrate] Applying: ${f}"
  # Run within a transaction block if file doesn't include its own BEGIN/COMMIT.
  # We let SQL authors include BEGIN/COMMIT where desired.
  if ! psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${f}"; then
    echo "[migrate][ERROR] Migration failed: ${f}"
    exit 10
  fi
done

echo "[migrate] All migrations applied successfully."

