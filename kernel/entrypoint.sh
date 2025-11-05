#!/bin/sh
# kernel/entrypoint.sh - POSIX sh for alpine
# Runs migrations (if configured) then starts the node server.
set -eu

# Print environment summary for debugging (non-sensitive)
echo "== entrypoint: starting =="
echo "NODE_ENV=${NODE_ENV:-}"
echo "PORT=${PORT:-}"
echo "POSTGRES_URL=${POSTGRES_URL:-<not-set>}"
echo "MIGRATE_CMD=${MIGRATE_CMD:-<not-set>}"

# Run migrations if MIGRATE_CMD provided, else run built migrate script if present.
if [ -n "${MIGRATE_CMD:-}" ]; then
  echo "Running migrations via MIGRATE_CMD: ${MIGRATE_CMD}"
  sh -c "${MIGRATE_CMD}"
elif [ -f ./dist/migrate.js ]; then
  echo "Running Node migration script: node ./dist/migrate.js"
  node ./dist/migrate.js
else
  echo "No migration step found, skipping migrations"
fi

# Start the server
echo "Starting server: node ./dist/server.js"
exec node ./dist/server.js
