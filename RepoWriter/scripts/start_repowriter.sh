#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./start_repowriter.sh        -> starts in dev mode (default)
#   ./start_repowriter.sh dev
#   ./start_repowriter.sh prod  -> run production start (expects built dist/)

# Change this if your repo is elsewhere
REPO="${HOME}/ILLUVRSE/Main"
PIDS_DIR="$REPO/.repowriter_pids"
LOGDIR="$REPO/RepoWriter/server"
MOCK_LOG="$REPO/RepoWriter/test/openaiMock.log"
WEB_LOG="$REPO/RepoWriter/RepoWriter/web/preview.log"

mkdir -p "$PIDS_DIR"
mkdir -p "$LOGDIR"

MODE="${1:-dev}"

echo "Starting RepoWriter services (mode=$MODE)..."

# 1) Start OpenAI mock if not running (dev convenience)
if [ -f "$PIDS_DIR/openai.pid" ] && kill -0 "$(cat "$PIDS_DIR/openai.pid")" 2>/dev/null; then
  echo "OpenAI mock already running (pid $(cat "$PIDS_DIR/openai.pid"))"
else
  echo "Starting OpenAI mock..."
  if [ -f "$REPO/RepoWriter/test/openaiMock.js" ]; then
    NODE_PATH="$REPO/RepoWriter/server/node_modules" node "$REPO/RepoWriter/test/openaiMock.js" > "$MOCK_LOG" 2>&1 &
    echo $! > "$PIDS_DIR/openai.pid"
    echo "OpenAI mock pid $(cat "$PIDS_DIR/openai.pid")"
  else
    echo "OpenAI mock not found at $REPO/RepoWriter/test/openaiMock.js — skipping mock start"
  fi
fi

# 2) Start server (dev or prod)
if [ -f "$PIDS_DIR/server.pid" ] && kill -0 "$(cat "$PIDS_DIR/server.pid")" 2>/dev/null; then
  echo "Server already running (pid $(cat "$PIDS_DIR/server.pid"))"
else
  echo "Starting server (mode=$MODE)..."
  export OPENAI_API_KEY="${OPENAI_API_KEY:-test-key}"
  export OPENAI_API_URL="${OPENAI_API_URL:-http://127.0.0.1:9876}"

  if [ "$MODE" = "prod" ]; then
    # Production-style run: use the compiled JS at RepoWriter/server/dist/index.js
    if [ -f "$REPO/RepoWriter/server/dist/index.js" ]; then
      echo "Running compiled server: node dist/index.js"
      nohup node "$REPO/RepoWriter/server/dist/index.js" > "$LOGDIR/server.log" 2>&1 &
      echo $! > "$PIDS_DIR/server.pid"
      echo "Server pid $(cat "$PIDS_DIR/server.pid") (logs: $LOGDIR/server.log)"
    else
      echo "Compiled server not found at dist/index.js. Building and starting as fallback..."
      (cd "$REPO/RepoWriter/server" && npm ci && npm run build)
      nohup node "$REPO/RepoWriter/server/dist/index.js" > "$LOGDIR/server.log" 2>&1 &
      echo $! > "$PIDS_DIR/server.pid"
      echo "Server pid $(cat "$PIDS_DIR/server.pid") (logs: $LOGDIR/server.log)"
    fi
  else
    # Dev-mode: run TypeScript source via npm script (nodemon + ts-node)
    nohup npm --prefix "$REPO/RepoWriter/server" run dev > "$LOGDIR/server.log" 2>&1 &
    echo $! > "$PIDS_DIR/server.pid"
    echo "Server pid $(cat "$PIDS_DIR/server.pid") (logs: $LOGDIR/server.log)"
  fi
fi

# 3) Start web preview (vite preview) — unchanged
if [ -f "$PIDS_DIR/web.pid" ] && kill -0 "$(cat "$PIDS_DIR/web.pid")" 2>/dev/null; then
  echo "Web preview already running (pid $(cat "$PIDS_DIR/web.pid"))"
else
  if [ -d "$REPO/RepoWriter/web" ]; then
    echo "Starting web preview..."
    (cd "$REPO/RepoWriter/web" && nohup npm run preview > "$WEB_LOG" 2>&1 & echo $! > "$PIDS_DIR/web.pid")
    echo "Web preview pid $(cat "$PIDS_DIR/web.pid") (logs: $WEB_LOG)"
  else
    echo "Web project not found at $REPO/RepoWriter/web — skipping web preview"
  fi
fi

echo "All started. To stop: run stop_repowriter.sh or use the desktop Stop button."

