#!/usr/bin/env bash
set -u
# scripts/run_final_audit.sh
#
# Supervised final audit verification script for ILLUVRSE/Main.
#
# This script:
# - Runs kernel/tools/audit-verify.js if present and DB env is provided
# - Runs memory-layer/service/audit/verifyTool.ts if present and DB env set
# - Runs reasoning-graph/tools/verifySnapshot.js if present (optional)
# - Runs finance tools/generate_ledger_proof.* if present
#
# Exit codes:
#   0  - all executed checks passed (skipped checks do NOT cause failure)
#   1  - one or more executed checks failed
#
# Note: this script is intentionally permissive if environment variables are missing.
#       It prints instructions so CI / operator can set the required envs.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASSED=0
FAILED=0
SKIPPED=0

log() { printf '\n[run_final_audit] %s\n' "$*"; }
run_cmd() {
  local desc="$1"
  shift
  log "STEP: $desc"
  printf '  → Running: %s\n' "$*"
  if "$@"; then
    log "  ✓ PASSED: $desc"
    PASSED=$((PASSED+1))
    return 0
  else
    local rc=$?
    log "  ✗ FAILED: $desc (exit $rc)"
    FAILED=$((FAILED+1))
    return $rc
  fi
}

skip_step() {
  local desc="$1"
  log "SKIPPED: $desc"
  SKIPPED=$((SKIPPED+1))
}

# 1) Kernel audit verify
KERNEL_AUDIT_VERIFY="$REPO_ROOT/kernel/tools/audit-verify.js"
KERNEL_SIGNERS="$REPO_ROOT/kernel/tools/signers.json"
if [ -f "$KERNEL_AUDIT_VERIFY" ]; then
  # Choose a DB URL env var (operator/CI should set one of these)
  DB_CANDIDATES=("KERNEL_AUDIT_DB" "KERNEL_DATABASE_URL" "POSTGRES_URL" "DATABASE_URL")
  DBURL=""
  for v in "${DB_CANDIDATES[@]}"; do
    if [ -n "${!v:-}" ]; then
      DBURL="${!v}"
      break
    fi
  done

  if [ -z "$DBURL" ]; then
    skip_step "Kernel audit verify (missing DB env). Set one of: ${DB_CANDIDATES[*]} to run kernel audit verify."
  else
    if [ ! -f "$KERNEL_SIGNERS" ]; then
      skip_step "Kernel audit verify: signer registry not found ($KERNEL_SIGNERS)."
    else
      run_cmd "Kernel audit verification (kernel/tools/audit-verify.js)" node "$KERNEL_AUDIT_VERIFY" -d "$DBURL" -s "$KERNEL_SIGNERS"
    fi
  fi
else
  skip_step "Kernel audit verify (script not present: $KERNEL_AUDIT_VERIFY)"
fi

# 2) Memory-layer audit verifyTool (TypeScript)
MEM_VERIFY_TS="$REPO_ROOT/memory-layer/service/audit/verifyTool.ts"
if [ -f "$MEM_VERIFY_TS" ]; then
  # determine DB URL
  DB_CAND=("MEMORY_DATABASE_URL" "DATABASE_URL" "POSTGRES_URL")
  DBURL=""
  for v in "${DB_CAND[@]}"; do
    if [ -n "${!v:-}" ]; then
      DBURL="${!v}"
      break
    fi
  done
  if [ -z "$DBURL" ]; then
    skip_step "Memory-layer audit verifyTool (missing DB env). Set one of: ${DB_CAND[*]} to run it."
  else
    # Use npx ts-node to run TypeScript verify tool
    if command -v npx >/dev/null 2>&1; then
      run_cmd "Memory-layer audit verification (memory-layer/service/audit/verifyTool.ts)" \
        env DATABASE_URL="$DBURL" npx ts-node "$MEM_VERIFY_TS"
    else
      skip_step "Memory-layer audit verifyTool (npx not installed). Install Node + npx to run."
    fi
  fi
else
  skip_step "Memory-layer audit verifyTool (not present: $MEM_VERIFY_TS)"
fi

# 3) Reasoning-graph snapshot verify (optional)
RG_VERIFY_JS="$REPO_ROOT/reasoning-graph/tools/verifySnapshot.js"
RG_VERIFY_TS="$REPO_ROOT/reasoning-graph/tools/verifySnapshot.ts"
if [ -f "$RG_VERIFY_JS" ]; then
  run_cmd "Reasoning-graph snapshot verify (verifySnapshot.js)" node "$RG_VERIFY_JS"
elif [ -f "$RG_VERIFY_TS" ]; then
  if command -v npx >/dev/null 2>&1; then
    run_cmd "Reasoning-graph snapshot verify (verifySnapshot.ts)" npx ts-node "$RG_VERIFY_TS"
  else
    skip_step "Reasoning-graph snapshot verify (npx not available to run TypeScript tool)."
  fi
else
  skip_step "Reasoning-graph snapshot verify (no verifySnapshot tool found)"
fi

# 4) Finance: generate & verify ledger proof (if script exists)
FIN_SH="$REPO_ROOT/finance/tools/generate_ledger_proof.sh"
FIN_GO="$REPO_ROOT/finance/tools/generate_ledger_proof.go"
if [ -f "$FIN_SH" ] || [ -f "$FIN_GO" ]; then
  # Compute date range (from = 30 days ago; to = today) using python3 for portability
  if command -v python3 >/dev/null 2>&1; then
    FROM_TO=$(python3 - <<'PY'
import datetime
to_dt = datetime.date.today()
from_dt = to_dt - datetime.timedelta(days=30)
print(f"{from_dt.isoformat()} {to_dt.isoformat()}")
PY
)
    FROM_DATE=${FROM_TO%% *}
    TO_DATE=${FROM_TO##* }
  else
    # Fallback: use 'date' (Linux-style). If fails, skip.
    if date -d "30 days ago" >/dev/null 2>&1; then
      FROM_DATE=$(date -d "30 days ago" +%F)
      TO_DATE=$(date +%F)
    else
      skip_step "Finance ledger proof generation (no python3 and 'date -d' not available to compute dates)."
      FROM_DATE=""
      TO_DATE=""
    fi
  fi

  if [ -n "${FROM_DATE:-}" ] && [ -n "${TO_DATE:-}" ]; then
    if [ -f "$FIN_SH" ]; then
      chmod +x "$FIN_SH" || true
      run_cmd "Finance generate ledger proof (sh)" "$FIN_SH" --from "$FROM_DATE" --to "$TO_DATE" || true
    elif [ -f "$FIN_GO" ]; then
      if command -v go >/dev/null 2>&1; then
        run_cmd "Finance generate ledger proof (go)" go run "$FIN_GO" --from "$FROM_DATE" --to "$TO_DATE"
      else
        skip_step "Finance ledger proof (go) - go toolchain not installed."
      fi
    fi
  fi
else
  skip_step "Finance ledger proof tool not found (finance/tools/generate_ledger_proof.*)"
fi

# 5) Optional: memory-layer auditReplay (dry-run) if present
AUDIT_REPLAY_TS="$REPO_ROOT/memory-layer/tools/auditReplay.ts"
if [ -f "$AUDIT_REPLAY_TS" ]; then
  if command -v npx >/dev/null 2>&1; then
    run_cmd "Memory-layer auditReplay (dry-run)" npx ts-node "$AUDIT_REPLAY_TS" --dry-run || true
  else
    skip_step "memory-layer auditReplay (npx not installed)"
  fi
else
  skip_step "memory-layer auditReplay tool not present"
fi

# Final summary
echo
log "FINAL SUMMARY:"
log "  PASSED : $PASSED"
log "  FAILED : $FAILED"
log "  SKIPPED: $SKIPPED"

if [ "$FAILED" -gt 0 ]; then
  log "One or more audit checks failed. Inspect logs above for failures."
  exit 1
fi

if [ "$SKIPPED" -gt 0 ]; then
  log "Some checks were skipped because required environment variables or tools were missing."
  log "To run all checks, ensure you have:"
  log "  - DB connection environment variables (e.g., KERNEL_AUDIT_DB, DATABASE_URL, POSTGRES_URL)"
  log "  - node / npx installed for JS/TS tools"
  log "  - python3 (optional, used to generate date ranges)"
  log "Run this script again once the environment is prepared."
fi

log "Final audit verification completed with no failures."
exit 0

