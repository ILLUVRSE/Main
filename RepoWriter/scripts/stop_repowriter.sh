#!/usr/bin/env bash
set -euo pipefail

REPO="$HOME/ILLUVRSE/Main"
PIDS_DIR="$REPO/.repowriter_pids"

stop_one() {
  name="$1"
  pidfile="$PIDS_DIR/${name}.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill "$pid" >/dev/null 2>&1; then
      echo "Sent TERM to $name ($pid)"
      sleep 1
      if kill -0 "$pid" >/dev/null 2>&1; then
        echo "$name still alive, forcing kill..."
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    else
      echo "$name pid $pid not running"
    fi
    rm -f "$pidfile"
  else
    echo "$name not running (no pid file)"
  fi
}

echo "Stopping RepoWriter services..."

stop_one "web"
stop_one "server"
stop_one "openai"

# As fallback, try to kill lingering processes by pattern (safe for local dev)
pkill -f "openaiMock.js" || true
pkill -f "nodemon --watch src --ext ts --exec node --loader ts-node/esm src/index.ts" || true
pkill -f "vite preview" || true

echo "Stopped. You can inspect logs in RepoWriter/server/server.log and RepoWriter/test/openaiMock.log"

