#!/usr/bin/env bash
set -euo pipefail

# Stops services started by start_repowriter.sh
# Usage:
#   ./stop_repowriter.sh

REPO="${HOME}/ILLUVRSE/Main"
PIDS_DIR="$REPO/.repowriter_pids"
LOGDIR="$REPO/RepoWriter/server"

function stop_pidfile() {
  local name="$1"
  local pidfile="$PIDS_DIR/${name}.pid"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile" 2>/dev/null || echo "")"
    if [ -n "$pid" ]; then
      if kill -0 "$pid" 2>/dev/null; then
        echo "Stopping $name (pid $pid)..."
        kill "$pid" || true
        # wait up to 10s for process to exit
        for i in $(seq 1 10); do
          if kill -0 "$pid" 2>/dev/null; then
            sleep 1
          else
            break
          fi
        done
        if kill -0 "$pid" 2>/dev/null; then
          echo "$name did not exit gracefully; sending SIGKILL"
          kill -9 "$pid" || true
        fi
      else
        echo "$name pid $pid not running"
      fi
    fi
    rm -f "$pidfile"
    echo "Removed pidfile $pidfile"
  else
    echo "No pidfile for $name at $pidfile"
  fi
}

echo "Stopping RepoWriter services..."

# stop web preview
stop_pidfile "web"

# stop server
stop_pidfile "server"

# stop openai mock
stop_pidfile "openai"

echo "All requested services signaled to stop."

# optional: tail server log for last few lines for quick debugging
if [ -f "$LOGDIR/server.log" ]; then
  echo "----- last 80 lines of server log -----"
  tail -n 80 "$LOGDIR/server.log" || true
  echo "--------------------------------------"
fi

