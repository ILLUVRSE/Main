#!/usr/bin/env bash
# kernel/scripts/run-migrations.sh
#
# Small helper to apply SQL migrations for the Kernel module in an idempotent way.
# - Prefer the compiled JS migration runner (dist/db/index.js) which waits for Postgres.
# - Fallback to psql executing the SQL migration directly.
#
# Usage:
#   # from repo root or kernel/; this script expects to be run with cwd=kernel
#   ./scripts/run-migrations.sh
#
# Environment:
#   POSTGRES_URL  - required for the psql fallback or when the runner uses it (example: postgresql://user:pass@host:5432/illuvrse)
#
# Notes:
# - DO NOT commit secrets. Inject POSTGRES_URL via environment/host secrets.
# - This script is safe to run repeatedly (migrations should be idempotent).
# - For production, prefer a dedicated migration tool (Flyway, liquibase, etc.). This is for CI/local/dev.

set -euo pipefail

# Change to kernel directory if invoked from repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo "[run-migrations] working dir: $(pwd)"
echo "[run-migrations] NODE_ENV=${NODE_ENV:-development}"

# If compiled migration runner exists, use it (it waits for Postgres)
if [ -f "./dist/db/index.js" ]; then
  echo "[run-migrations] Found compiled migration runner: ./dist/db/index.js"
  node ./dist/db/index.js
  echo "[run-migrations] Migration runner finished."
  exit 0
fi

# Fallback to psql + SQL files
if [ -z "${POSTGRES_URL:-}" ]; then
  echo "[run-migrations] ERROR: POSTGRES_URL not set and no compiled migration runner found."
  echo "[run-migrations] Set POSTGRES_URL or build the project so dist/db/index.js is available."
  exit 2
fi

# Locate migrations directory
MIGRATIONS_DIR="./sql/migrations"
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "[run-migrations] No migrations directory found at $MIGRATIONS_DIR. Nothing to do."
  exit 0
fi

# Apply migrations in lexical order (files ending with .sql)
echo "[run-migrations] Applying SQL migrations from $MIGRATIONS_DIR"
for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  echo "[run-migrations] Applying $f"
  psql "$POSTGRES_URL" -f "$f"
done

echo "[run-migrations] All migrations applied."

# Acceptance checks:
# - If dist/db/index.js exists, node runner should run and exit 0.
# - When using psql: POSTGRES_URL must be set and each SQL file should apply without error.
# - Script is idempotent: running it twice should not fail for the provided migrations.

