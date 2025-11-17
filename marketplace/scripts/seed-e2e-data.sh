#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
SQL_FILE="${ROOT_DIR}/data/e2e-skus.sql"

usage() {
  cat <<EOF
Usage: $0 [DATABASE_URL]

Apply seed data for E2E tests (e2e-sku-001) using SQL file:
  ${SQL_FILE}

If DATABASE_URL is omitted, this script uses the DATABASE_URL env var.

Example:
  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/marketplace ./scripts/seed-e2e-data.sh
  or
  ./scripts/seed-e2e-data.sh "postgres://postgres:postgres@127.0.0.1:5432/marketplace"
EOF
  exit 1
}

DB_URL="${1:-${DATABASE_URL:-}}"

if [ -z "${DB_URL}" ]; then
  echo "ERROR: DATABASE_URL not provided."
  usage
fi

if [ ! -f "${SQL_FILE}" ]; then
  echo "ERROR: Seed SQL file not found at ${SQL_FILE}"
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required but not found in PATH. Install postgresql client tools."
  exit 3
fi

echo "[seed-e2e] Applying ${SQL_FILE} to ${DB_URL}"
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${SQL_FILE}"

echo "[seed-e2e] Done."

