#!/bin/bash
# agent-manager/scripts/test-manifest-enforce.sh

# Start the server in background if needed, but integration tests usually use supertest.
# Here we use curl against a running server or node script.
# We will use a node script to perform the test logic for better crypto handling.

node agent-manager/scripts/test_manifest_enforce_runner.js
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "Manifest enforcement tests passed."
  exit 0
else
  echo "Manifest enforcement tests failed."
  exit 1
fi
