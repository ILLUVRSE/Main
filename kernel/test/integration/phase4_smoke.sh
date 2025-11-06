#!/usr/bin/env bash
# kernel/test/integration/phase4_smoke.sh
# Integration smoke that runs the Phase 4 OIDC + mTLS smoke tests.
# Usage: from repo root: ./kernel/test/integration/phase4_smoke.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNNER="$REPO_ROOT/devops/scripts/run_phase4_smoke.sh"

# helper
info(){ echo "[INFO] $*"; }
fail(){ echo "[FAIL] $*" >&2; exit 1; }

# Preconditions
if [ ! -x "$RUNNER" ]; then
  fail "runner not found or not executable: $RUNNER"
fi

info "Running Phase4 smoke via: $RUNNER"
# run and capture output
OUT="$(mktemp)"
if "$RUNNER" > "$OUT" 2>&1; then
  info "Phase4 smoke script succeeded. Output:"
  sed -n '1,200p' "$OUT"
  rm -f "$OUT"
  info "INTEGRATION SMOKE: PASS"
  exit 0
else
  echo "==== full output ===="
  sed -n '1,400p' "$OUT" || true
  echo "==== end output ===="
  rm -f "$OUT"
  fail "INTEGRATION SMOKE: FAIL"
fi

