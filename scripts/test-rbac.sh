#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[test-rbac] Running targeted RBAC test suite..."
npm --prefix kernel run test -- --runTestsByPath \
  test/middleware/auth.test.ts \
  test/middleware/rbac.test.ts \
  test/middleware/errorHandler.test.ts \
  test/unit/require_roles.unit.test.ts \
  test/unit/require_any.unit.test.ts \
  test/unit/rbac_enforcement.test.ts \
  test/integration/post_kernel_create.test.ts \
  test/integration/mtls.integration.test.ts

echo "[test-rbac] Completed."
