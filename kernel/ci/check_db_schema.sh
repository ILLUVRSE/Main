#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTGRES_URL="${POSTGRES_URL:-postgresql://postgres:postgres@localhost:5432/kernel_ci}"

echo "[check_db_schema] Using POSTGRES_URL=${POSTGRES_URL}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for schema checks" >&2
  exit 1
fi

echo "[check_db_schema] Running migrations..."
psql "${POSTGRES_URL}" -v ON_ERROR_STOP=1 -f "${ROOT_DIR}/sql/migrations/001_init.sql" >/dev/null

required_tables=(audit_events manifest_signatures idempotency agents divisions)

echo "[check_db_schema] Verifying required tables..."
for table in "${required_tables[@]}"; do
  exists=$(psql "${POSTGRES_URL}" -tAc "SELECT to_regclass('public.${table}') IS NOT NULL")
  if [[ "${exists}" != "t" && "${exists}" != "true" ]]; then
    echo "Missing required table: ${table}" >&2
    exit 1
  fi
done

echo "[check_db_schema] Schema verification succeeded."

