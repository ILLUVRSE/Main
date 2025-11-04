#!/usr/bin/env bash
set -euo pipefail

MIGRATION_FILE="$(dirname "$0")/../migrations/0001_create_tables.sql"

if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "Migration file not found: $MIGRATION_FILE"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL environment variable is required."
  echo "Example:"
  echo "  export DATABASE_URL='postgres://user:pass@host:5432/dbname?sslmode=disable'"
  exit 2
fi

echo "Applying migration: $MIGRATION_FILE -> $DATABASE_URL"
# Use psql to execute the migration
# Ensure psql is installed and DATABASE_URL contains credentials or .pgpass is configured.
psql "$DATABASE_URL" -f "$MIGRATION_FILE"

echo "Migration applied successfully."

