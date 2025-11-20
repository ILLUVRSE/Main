#!/usr/bin/env bash
# kernel/ci/require_kms_check.sh
#
# Guardrail that fails early when the configured signing proxy or KMS endpoint is unreachable.
# The script succeeds (exit 0) once a reachable endpoint is found, otherwise it exits >0.
set -euo pipefail

HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-5}
REQUIRE_KMS="${REQUIRE_KMS:-false}"
REQUIRE_SIGNING_PROXY="${REQUIRE_SIGNING_PROXY:-false}"
KMS_ENDPOINT="${KMS_ENDPOINT:-}"
SIGNING_PROXY_URL="${SIGNING_PROXY_URL:-}"

log() {
  echo "[require_kms_check] $*"
}

is_true() {
  case "$1" in
    true|TRUE|1|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

probe() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m "$HEALTH_TIMEOUT" "$url" >/dev/null 2>&1
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q --timeout="$HEALTH_TIMEOUT" --spider "$url" >/dev/null 2>&1
    return $?
  fi
  log "FATAL: neither curl nor wget is available to probe $url"
  return 9
}

checked=0

if [[ -n "$SIGNING_PROXY_URL" ]]; then
  checked=1
  HEALTH_TARGET="${SIGNING_PROXY_URL%/}/health"
  log "Checking signing proxy health at ${HEALTH_TARGET}"
  if ! probe "$HEALTH_TARGET"; then
    log "Signing proxy unreachable: ${SIGNING_PROXY_URL}"
    exit 2
  fi
  log "Signing proxy reachable"
fi

if [[ -n "$KMS_ENDPOINT" ]]; then
  checked=1
  KMS_TARGET="${KMS_ENDPOINT%/}"
  log "Checking KMS endpoint health at ${KMS_TARGET}"
  if ! probe "$KMS_TARGET"; then
    FALLBACK="${KMS_TARGET%/}/health"
    log "Primary KMS probe failed, retrying ${FALLBACK}"
    if ! probe "$FALLBACK"; then
      log "KMS endpoint unreachable: ${KMS_ENDPOINT}"
      exit 3
    fi
  fi
  log "KMS reachable"
fi

if [[ $checked -eq 0 ]]; then
  if is_true "$REQUIRE_SIGNING_PROXY"; then
    log "REQUIRE_SIGNING_PROXY=true but SIGNING_PROXY_URL unset"
    exit 4
  fi
  if is_true "$REQUIRE_KMS"; then
    log "REQUIRE_KMS=true but KMS_ENDPOINT unset"
    exit 5
  fi
  log "No SIGNING_PROXY_URL or KMS_ENDPOINT configured; skipping check"
  exit 1
fi

exit 0
