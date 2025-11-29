#!/bin/bash
set -e

# verify signing integration
# This script runs the specific tests for signing integration.
# It assumes 'kernel' environment is available.

echo "Running Manifest Signing integration tests..."

# Run the signingProxy integration tests
npm --prefix kernel run test -- kernel/test/signingProxy.test.ts

# Run the kernelRoutes test that covers /kernel/sign
# We need to find which test file covers /kernel/sign.
# Usually it's in kernel/test/routes/
# Let's check kernel/test/routes/kernelRoutes.test.ts (I assume it exists, let me verify)
if [ -f "kernel/test/routes/kernelRoutes.test.ts" ]; then
  npm --prefix kernel run test -- kernel/test/routes/kernelRoutes.test.ts
fi

# Also check if there is a specific acceptance test for signing
if [ -f "kernel/test/integration/signing.test.ts" ]; then
  npm --prefix kernel run test -- kernel/test/integration/signing.test.ts
fi

echo "Manifest Signing verification complete."
