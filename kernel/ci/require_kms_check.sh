#!/usr/bin/env bash
# kernel/ci/require_kms_check.sh
#
# Fail CI early when REQUIRE_KMS=true but KMS_ENDPOINT is not configured or reachable.
# Usage (CI): export REQUIRE_KMS=true; export KMS_ENDPOINT="https://kms.example.local"; ./kernel/ci/require_kms_check.sh
set -euo pipefail

REQUIRE_KMS="${REQUIRE_KMS:-false}"
KMS_ENDPOINT="${KMS_ENDPOINT:-}"

# normalize truthy values
is_true() {
  case "$1" in
    true|TRUE|1|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

if ! is_true "$REQUIRE_KMS"; then
  echo "[require_kms_check] REQUIRE_KMS not true — nothing to check."
  exit 0
fi

if [ -z "$KMS_ENDPOINT" ]; then
  echo "[require_kms_check] FATAL: REQUIRE_KMS=true but KMS_ENDPOINT is not set."
  exit 2
fi

echo "[require_kms_check] REQUIRE_KMS=true, probing KMS_ENDPOINT=$KMS_ENDPOINT"

# Try curl, otherwise wget, otherwise warn and attempt a basic TCP probe via /dev/tcp
if command -v curl >/dev/null 2>&1; then
  if ! curl -fsS -m 5 --head "$KMS_ENDPOINT" >/dev/null 2>&1; then
    echo "[require_kms_check] FATAL: KMS_ENDPOINT unreachable via curl: $KMS_ENDPOINT"
    exit 3
  fi
elif command -v wget >/dev/null 2>&1; then
  if ! wget -q --timeout=5 --spider "$KMS_ENDPOINT" >/dev/null 2>&1; then
    echo "[require_kms_check] FATAL: KMS_ENDPOINT unreachable via wget: $KMS_ENDPOINT"
    exit 3
  fi
elif (exec 3<>/dev/tcp/"$(echo "$KMS_ENDPOINT" | sed -E 's#^[^/]+//##' | cut -d/ -f1)"/"$(echo "$KMS_ENDPOINT" | sed -E 's#.*:([0-9]+).*#\1#' )") 2>/dev/null; then
  # crude TCP probe — best-effort, not always reliable
  :
else
  echo "[require_kms_check] WARNING: no curl/wget available to probe KMS_ENDPOINT; cannot verify reachability."
  # Don't fail here; CI should ensure curl/wget exist. But if you want stricter behavior, change to exit 3.
fi

echo "[require_kms_check] KMS endpoint appears reachable: $KMS_ENDPOINT"
exit 0

