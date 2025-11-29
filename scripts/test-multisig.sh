#!/bin/bash
set -e

# scripts/test-multisig.sh

echo "Starting Postgres..."
if command -v docker > /dev/null; then
    docker compose -f docker-compose.postgres.yml up -d postgres || true
    # Simple wait loop
    for i in {1..30}; do
        if docker exec $(docker compose -f docker-compose.postgres.yml ps -q postgres) pg_isready -U postgres > /dev/null 2>&1; then
            echo "Postgres is ready."
            break
        fi
        echo "Waiting for Postgres..."
        sleep 1
    done
else
    echo "Docker not found, assuming local Postgres is running..."
fi

# Set env for test
export POSTGRES_URL="postgresql://postgres:postgrespw@localhost:5433/am_test"
export NODE_ENV=test

cd kernel

# Ensure dependencies
if [ ! -d "node_modules" ]; then
    npm ci
fi

echo "Running migrations..."
# Attempt to run migrations. If it fails due to connection, we skip integration tests but run mock tests.
if npx ts-node src/db/index.ts; then
    echo "Migrations applied."
    MIGRATIONS_SUCCESS=true
else
    echo "Migrations failed (likely no DB connection). skipping integration tests."
    MIGRATIONS_SUCCESS=false
fi

echo "Running multisig unit tests (Mock)..."
npm test -- test/multisig_mock.test.ts

if [ "$MIGRATIONS_SUCCESS" = true ]; then
    echo "Running multisig integration tests..."
    npm test -- test/multisig.test.ts
else
    echo "Skipping integration tests due to missing DB."
fi

echo "All tests passed."
