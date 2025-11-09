#!/usr/bin/env bash
set -euo pipefail

MIGRATIONS_DIR="db/migrations"

usage() {
  cat <<EOF
Usage: DATABASE_URL="postgres://user:pass@host:port/db" $0
This script applies all SQL files in ${MIGRATIONS_DIR} in lexical order.
It prefers local 'psql' but will fall back to dockerized psql.
EOF
  exit 1
}

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  usage
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: migrations directory not found: $MIGRATIONS_DIR"
  exit 1
fi

# Apply with local psql if available
if command -v psql >/dev/null 2>&1; then
  echo "Using local psql to apply migrations to $DATABASE_URL"
  for f in "$MIGRATIONS_DIR"/*.sql; do
    echo "--- Applying $f"
    psql "$DATABASE_URL" -f "$f"
  done
  echo "Migrations applied with local psql."
  exit 0
fi

# If local psql not found, require docker
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: neither 'psql' nor 'docker' found on PATH. Install one and re-run."
  exit 1
fi

echo "Local psql not found. Falling back to dockerized psql."

# Parse DATABASE_URL (expected form: postgres://user:pass@host:port/dbname)
proto_and_rest=${DATABASE_URL#*://}
if [ "$proto_and_rest" = "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not in expected form 'postgres://user:pass@host:port/dbname'"
  exit 1
fi

userpass=${proto_and_rest%%@*}         # user:pass
hostportdb=${proto_and_rest#*@}       # host:port/dbname
user=${userpass%%:*}
pass=${userpass#*:}
hostport=${hostportdb%%/*}
dbname=${hostportdb#*/}
host=${hostport%%:*}
port=${hostport#*:}

# If am-postgres container exists, use --link to it (common local dev)
if docker ps -q -f name=am-postgres | grep -q .; then
  echo "Detected 'am-postgres' container; using --link am-postgres:db"
  for f in "$MIGRATIONS_DIR"/*.sql; do
    echo "--- Applying $f via docker linked to am-postgres"
    docker run --rm --link am-postgres:db -e PGPASSWORD="$pass" -v "$PWD":/work -w /work postgres:15 \
      psql -h db -U "$user" -d "$dbname" -f "$f"
  done
  echo "Migrations applied via docker->am-postgres."
  exit 0
fi

# Otherwise connect to host:port from DATABASE_URL
echo "Applying migrations via docker psql to ${host}:${port}/${dbname}"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "--- Applying $f via dockerized psql"
  docker run --rm -e PGPASSWORD="$pass" -v "$PWD":/work -w /work postgres:15 \
    psql -h "$host" -p "$port" -U "$user" -d "$dbname" -f "$f"
done

echo "Migrations applied via docker psql."

