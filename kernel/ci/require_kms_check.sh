#!/usr/bin/env bash
# kernel/ci/require_kms_check.sh
#
# Fail CI early when REQUIRE_KMS=true but KMS_ENDPOINT is not configured or reachable.
# Usage (CI): export REQUIRE_KMS=true; export KMS_ENDPOINT="https://kms.example.local"; ./kernel/ci/require_kms_check.sh
set -euo pipefail

REQUIRE_KMS="${REQUIRE_KMS:-false}"
REQUIRE_SIGNING_PROXY="${REQUIRE_SIGNING_PROXY:-false}"
KMS_ENDPOINT="${KMS_ENDPOINT:-}"
SIGNING_PROXY_URL="${SIGNING_PROXY_URL:-}"

# normalize truthy values
is_true() {
  case "$1" in
    true|TRUE|1|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

probe_http() {
  local url=$1
  local label=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 5 "$url" >/dev/null 2>&1
    return $?
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=5 --spider "$url" >/dev/null 2>&1
    return $?
  else
    echo "[require_kms_check] WARNING: $label cannot be probed because curl/wget are unavailable."
    return 0
  fi
}

if is_true "$REQUIRE_KMS"; then
  if [ -z "$KMS_ENDPOINT" ]; then
    echo "[require_kms_check] FATAL: REQUIRE_KMS=true but KMS_ENDPOINT is not set."
    exit 2
  fi
  echo "[require_kms_check] REQUIRE_KMS=true, probing KMS_ENDPOINT=$KMS_ENDPOINT"
  if ! probe_http "$KMS_ENDPOINT" "KMS"; then
    echo "[require_kms_check] FATAL: KMS_ENDPOINT unreachable: $KMS_ENDPOINT"
    exit 3
  fi
  echo "[require_kms_check] KMS endpoint appears reachable: $KMS_ENDPOINT"
fi

if is_true "$REQUIRE_SIGNING_PROXY"; then
  if [ -z "$SIGNING_PROXY_URL" ]; then
    echo "[require_kms_check] FATAL: REQUIRE_SIGNING_PROXY=true but SIGNING_PROXY_URL is not set."
    exit 4
  fi
  echo "[require_kms_check] REQUIRE_SIGNING_PROXY=true, probing SIGNING_PROXY_URL=$SIGNING_PROXY_URL"
  if ! probe_http "$SIGNING_PROXY_URL/health" "signing proxy"; then
    echo "[require_kms_check] FATAL: SIGNING_PROXY_URL unreachable: $SIGNING_PROXY_URL"
    exit 5
  fi
  echo "[require_kms_check] Signing proxy appears reachable: $SIGNING_PROXY_URL"
fi

if ! is_true "$REQUIRE_KMS" && ! is_true "$REQUIRE_SIGNING_PROXY"; then
  echo "[require_kms_check] Neither REQUIRE_KMS nor REQUIRE_SIGNING_PROXY enabled — nothing to check."
fi
exit 0
