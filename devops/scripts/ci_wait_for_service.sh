#!/usr/bin/env bash
# devops/scripts/ci_wait_for_service.sh
# Wait for a service to become ready in CI. One of -l, -u, or -H/-P is required.
set -euo pipefail

COMPOSE_FILE=""
SERVICE=""
TIMEOUT=120
PATTERN=""
URL=""
HOST=""
PORT=""

usage() {
  cat <<EOF
Usage: ci_wait_for_service.sh -f <compose-file> -s <service> -t <timeout-sec> ( -l <log-regex> | -u <http-url> | -H <host> -P <port> )

Examples:
  # Wait for Keycloak logs to contain Started or Quarkus
  ci_wait_for_service.sh -f devops/docker-compose.ci.yml -s keycloak -t 120 -l "Started|Quarkus"

  # Wait for HTTP readiness endpoint
  ci_wait_for_service.sh -f devops/docker-compose.ci.yml -s kernel -t 60 -u "https://localhost:3000/ready"

  # Wait for TCP port
  ci_wait_for_service.sh -f devops/docker-compose.ci.yml -s keycloak -t 30 -H localhost -P 8080
EOF
  exit 2
}

while getopts "f:s:t:l:u:H:P:h" opt; do
  case "$opt" in
    f) COMPOSE_FILE=$OPTARG ;;
    s) SERVICE=$OPTARG ;;
    t) TIMEOUT=$OPTARG ;;
    l) PATTERN=$OPTARG ;;
    u) URL=$OPTARG ;;
    H) HOST=$OPTARG ;;
    P) PORT=$OPTARG ;;
    h) usage ;;
    *) usage ;;
  esac
done

if [ -z "$COMPOSE_FILE" ] || [ -z "$SERVICE" ]; then
  echo "Error: -f and -s are required" >&2
  usage
fi

if [ -z "$PATTERN" ] && [ -z "$URL" ] && { [ -z "$HOST" ] || [ -z "$PORT" ]; }; then
  echo "Error: one of -l (log regex), -u (http url), or -H/-P (host/port) is required" >&2
  usage
fi

start_ts=$(date +%s)
end_ts=$((start_ts + TIMEOUT))
echo "Waiting up to ${TIMEOUT}s for service '${SERVICE}' using compose file '${COMPOSE_FILE}'..."

while [ "$(date +%s)" -le "$end_ts" ]; do
  if [ -n "$PATTERN" ]; then
    # Check recent logs for the pattern
    if docker compose -f "$COMPOSE_FILE" logs "$SERVICE" --tail 200 2>/dev/null | tail -n 200 | grep -E "$PATTERN" >/dev/null 2>&1; then
      echo "Service '$SERVICE' log pattern matched: $PATTERN"
      exit 0
    fi
  elif [ -n "$URL" ]; then
    # Try HTTP(S) endpoint
    if curl -fsS --max-time 3 "$URL" >/dev/null 2>&1; then
      echo "Service '$SERVICE' responded OK at $URL"
      exit 0
    fi
  else
    # TCP check via bash /dev/tcp
    if bash -c "cat < /dev/tcp/${HOST}/${PORT}" >/dev/null 2>&1; then
      echo "TCP ${HOST}:${PORT} is open"
      exit 0
    fi
  fi

  sleep 2
done

echo "Timed out waiting for service '${SERVICE}' after ${TIMEOUT}s" >&2
echo "==== Last 300 lines of logs for ${SERVICE} ===="
docker compose -f "$COMPOSE_FILE" logs "$SERVICE" --tail 300 || true
exit 1

