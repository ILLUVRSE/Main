#!/usr/bin/env bash
# Simple helper to Start / Stop / Status a static HTTP server serving devops/certs
# Usage:
#   ./start_jwks_server.sh start [port]
#   ./start_jwks_server.sh stop
#   ./start_jwks_server.sh status
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SCRIPT_DIR/../certs"
PORT="${2:-8000}"
PIDFILE="$CERT_DIR/.jwks_server.pid"

start() {
  if [ -f "$PIDFILE" ]; then
    pid="$(cat "$PIDFILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "JWKS server already running (pid=$pid)"
      exit 0
    else
      echo "Stale pidfile found, removing."
      rm -f "$PIDFILE"
    fi
  fi

  # Ensure cert dir exists
  if [ ! -d "$CERT_DIR" ]; then
    echo "Cert dir not found: $CERT_DIR"
    exit 1
  fi

  # Start the simple Python HTTP server in background
  (
    cd "$CERT_DIR"
    # Redirect logs to cert dir so it's easy to inspect
    python3 -m http.server "$PORT" > jwks_server.log 2>&1 &
    echo $! > "$PIDFILE"
  )

  sleep 0.2
  pid="$(cat "$PIDFILE")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "JWKS server started on http://localhost:$PORT (pid=$pid)"
    exit 0
  else
    echo "Failed to start JWKS server; see $CERT_DIR/jwks_server.log"
    rm -f "$PIDFILE"
    exit 2
  fi
}

stop() {
  if [ ! -f "$PIDFILE" ]; then
    echo "JWKS server not running (no pidfile)."
    exit 0
  fi
  pid="$(cat "$PIDFILE")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    sleep 0.1
    echo "Stopped JWKS server (pid=$pid)"
  else
    echo "Process $pid not running; removing pidfile."
  fi
  rm -f "$PIDFILE"
}

status() {
  if [ -f "$PIDFILE" ]; then
    pid="$(cat "$PIDFILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "JWKS server running (pid=$pid)"
      return 0
    else
      echo "JWKS pidfile present but process not running (pid=$pid)"
      return 1
    fi
  else
    echo "JWKS server not running"
    return 1
  fi
}

case "${1:-help}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) 
    cat <<'USAGE'
Usage: start_jwks_server.sh start [port]
       start_jwks_server.sh stop
       start_jwks_server.sh status

Default port: 8000
This serves ./devops/certs on http://localhost:<port>/ (jwks.json will be available as /jwks.json).
USAGE
    exit 1
    ;;
esac

