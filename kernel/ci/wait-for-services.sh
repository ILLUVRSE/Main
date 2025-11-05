#!/usr/bin/env bash
# kernel/ci/wait-for-services.sh
# Wait for one or more services (HTTP URL or host:port) to become available.
# Usage:
#   ./wait-for-services.sh [-t seconds] target1 [target2 ...]
# Targets:
#   - http(s) URLs are probed with curl and expected to return 2xx/3xx
#   - host:port entries are tested with bash /dev/tcp (works on Linux/bash)
#
# Examples:
#   ./wait-for-services.sh http://localhost:3000/health 127.0.0.1:5432
#   TIMEOUT=120 ./wait-for-services.sh https://localhost:8443/ready

set -euo pipefail

TIMEOUT=${TIMEOUT:-60}
INTERVAL=${INTERVAL:-2}

usage() {
  cat <<EOF
Usage: $0 [-t timeout-seconds] target1 [target2 ...]
Targets may be HTTP(S) URLs or host:port pairs.
Environment:
  TIMEOUT    overall seconds to wait for each target (default: ${TIMEOUT})
  INTERVAL   polling interval seconds (default: ${INTERVAL})
EOF
  exit 2
}

# Parse optional flags
while getopts ":t:i:" opt; do
  case $opt in
    t) TIMEOUT="$OPTARG" ;;
    i) INTERVAL="$OPTARG" ;;
    *) usage ;;
  esac
done
shift $((OPTIND -1))

if [ $# -lt 1 ]; then
  usage
fi

timestamp() { date +"%Y-%m-%d %H:%M:%S"; }

wait_for_url() {
  local url="$1"
  local deadline=$(( $(date +%s) + TIMEOUT ))
  echo "$(timestamp) waiting for URL ${url} (timeout ${TIMEOUT}s)..."
  while true; do
    if curl --silent --show-error --fail --insecure -L -o /dev/null "${url}"; then
      echo "$(timestamp) ${url} is available"
      return 0
    fi
    if [ $(date +%s) -ge ${deadline} ]; then
      echo "$(timestamp) timeout waiting for ${url}" >&2
      return 1
    fi
    sleep "${INTERVAL}"
  done
}

wait_for_tcp() {
  local hostport="$1"
  local host="${hostport%%:*}"
  local port="${hostport##*:}"
  if [ -z "${host}" ] || [ -z "${port}" ]; then
    echo "invalid host:port -> ${hostport}" >&2
    return 2
  fi

  local deadline=$(( $(date +%s) + TIMEOUT ))
  echo "$(timestamp) waiting for TCP ${host}:${port} (timeout ${TIMEOUT}s)..."

  while true; do
    # Prefer nc if available (more reliable). Otherwise use bash /dev/tcp.
    if command -v nc >/dev/null 2>&1; then
      if nc -z "${host}" "${port}" >/dev/null 2>&1; then
        echo "$(timestamp) ${host}:${port} is open"
        return 0
      fi
    else
      # /dev/tcp is a bash feature; test non-fatal
      if (echo > "/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
        echo "$(timestamp) ${host}:${port} is open"
        return 0
      fi
    fi

    if [ $(date +%s) -ge ${deadline} ]; then
      echo "$(timestamp) timeout waiting for ${host}:${port}" >&2
      return 1
    fi
    sleep "${INTERVAL}"
  done
}

overall_status=0

for target in "$@"; do
  if [[ "${target}" =~ ^https?:// ]]; then
    if ! wait_for_url "${target}"; then
      overall_status=1
      break
    fi
  else
    # treat as host:port
    if ! wait_for_tcp "${target}"; then
      overall_status=1
      break
    fi
  fi
done

if [ ${overall_status} -ne 0 ]; then
  echo "$(timestamp) one or more targets failed to become available" >&2
  exit ${overall_status}
fi

echo "$(timestamp) all targets are available"
exit 0

