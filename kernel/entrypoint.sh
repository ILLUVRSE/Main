#!/usr/bin/env bash
# kernel/entrypoint.sh
#
# Simple, robust container entrypoint for the Kernel service.
# - Copies SQL migrations into the compiled dist path expected by the migration runner.
# - Runs the migration runner (node dist/db/index.js) which waits for Postgres and applies migrations.
# - Starts the server (node dist/server.js) by exec'ing it so signals are delivered to Node.
#
# Notes:
# - DO NOT bake secrets into the image. Provide POSTGRES_URL, KMS_ENDPOINT, SIGNER_ID via environment.
# - The script exits non-zero on fatal errors so orchestrators can detect failure.

set -euo pipefail

echo "[entrypoint] starting container entrypoint"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-development}"
echo "[entrypoint] PORT=${PORT:-3000}"

if [[ -z "${POSTGRES_URL:-}" ]]; then
  echo "[entrypoint] WARNING: POSTGRES_URL is not set. The server will likely fail to start without a DB."
fi

# Ensure migrations are available under dist/sql/migrations for the compiled migration runner.
if [ -d "./sql/migrations" ]; then
  echo "[entrypoint] copying sql/migrations into dist/sql/migrations..."
  mkdir -p ./dist/sql
  # Remove any previous copy to keep things idempotent
  rm -rf ./dist/sql/migrations || true
  cp -R ./sql/migrations ./dist/sql/migrations
  echo "[entrypoint] migrations copied"
else
  echo "[entrypoint] no sql/migrations dir found at ./sql/migrations; relying on whatever dist/db expects"
fi

# Run migrations using the built migration runner if present
if [ -f "./dist/db/index.js" ]; then
  echo "[entrypoint] running migration runner: node ./dist/db/index.js"
  # This runner waits for Postgres and applies migrations (idempotent)
  node ./dist/db/index.js
  echo "[entrypoint] migrations complete"
else
  echo "[entrypoint] no dist/db/index.js found - skipping migration runner"
fi

# Start the server. Use exec so signals are delivered to node.
if [ -f "./dist/server.js" ]; then
  echo "[entrypoint] starting server: node ./dist/server.js"
  exec node ./dist/server.js
else
  echo "[entrypoint] ERROR: dist/server.js not found. Build step likely failed."
  exit 2
fi

