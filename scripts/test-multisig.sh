#!/bin/bash
set -e

echo "Running multisig tests..."

# Run Unit Tests (Mock)
echo "Running mock unit tests..."
npx vitest run kernel/test/multisig_mock.test.ts

# Run Integration Tests (if DB available)
if [ -z "$POSTGRES_URL" ]; then
  echo "Skipping integration tests (POSTGRES_URL not set)"
else
  echo "Running integration tests..."
  npx vitest run kernel/test/multisig.test.ts
fi

echo "Multisig tests passed!"
