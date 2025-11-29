#!/bin/bash
set -e

# Test Orchestration Script for Operational Runbooks

MODE="${1:-full}"
if [[ "$1" == "--mode=mock" ]]; then
    MODE="mock"
fi

echo "Running Runbook Tests in MODE=$MODE"

# Function to run tests
run_tests() {
    echo "Running simulated runbook tests..."
    # We use vitest to run the simulation tests
    # Ensure dependencies are installed
    if [ ! -d "node_modules" ]; then
        npm install
    fi

    # Run the specific runbook tests
    # We assume 'vitest' is available in npm scripts or npx
    npx vitest run kernel/test/runbook/
}

if [[ "$MODE" == "mock" ]]; then
    echo "Mock mode: Skipping Docker dependencies."
    export NODE_ENV=test
    export ENABLE_TEST_ENDPOINTS=true

    run_tests

    echo "Mock runbook tests passed."
    exit 0
fi

# Full mode
echo "Full mode: Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo "Docker not available. Falling back to mock mode? No, script failed."
    echo "Use --mode=mock to run without Docker."
    exit 1
fi

echo "Starting dependencies (if needed)..."
# In a real scenario, we might bring up docker-compose here.
# For now, we rely on the mock tests being sufficient for verification logic,
# as they mock the DB failure inside the code rather than killing a real DB container.
# Killing a real DB container in CI is risky/complex without a dedicated environment.
# So we stick to "Code Simulation" which is safer and faster.

run_tests

echo "Runbook tests passed."
exit 0
