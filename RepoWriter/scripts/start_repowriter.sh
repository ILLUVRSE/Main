#!/usr/bin/env bash
set -euo pipefail

# Change this if your repo is elsewhere
REPO="$HOME/ILLUVRSE/Main"
PIDS_DIR="$REPO/.repowriter_pids"
LOGDIR="$REPO/RepoWriter/server"
MOCK_LOG="$REPO/RepoWriter/test/openaiMock.log"
WEB_LOG="$REPO/RepoWriter/web/preview.log"
mkdir -p "$PIDS_DIR"

echo "Starting RepoWriter services..."
# 1) Start OpenAI mock if not running
if [ -f "$PIDS_DIR/openai.pid" ] && kill -0 "$(cat "$PIDS_DIR/openai.pid")" 2>/dev/null; then
  echo "OpenAI mock already running (pid $(cat "$PIDS_DIR/openai.pid"))"
else
  echo "Starting OpenAI mock..."
  NODE_PATH="$REPO/RepoWriter/server/node_modules" node "$REPO/RepoWriter/test/openaiMock.js" > "$MOCK_LOG" 2>&1 &
  echo $! > "$PIDS_DIR/openai.pid"
  echo "OpenAI mock pid $(cat "$PIDS_DIR/openai.pid")"
fi

# 2) Start server (dev)
if [ -f "$PIDS_DIR/server.pid" ] && kill -0 "$(cat "$PIDS_DIR/server.pid")" 2>/dev/null; then
  echo "Server already running (pid $(cat "$PIDS_DIR/server.pid"))"
else
  echo "Starting server (dev)..."
  export OPENAI_API_KEY="${OPENAI_API_KEY:-test-key}"
  export OPENAI_API_URL="${OPENAI_API_URL:-http://127.0.0.1:9876}"
  nohup npm --prefix "$REPO/RepoWriter/server" run dev > "$LOGDIR/server.log" 2>&1 &
  echo $! > "$PIDS_DIR/server.pid"
  echo "Server pid $(cat "$PIDS_DIR/server.pid") (logs: $LOGDIR/server.log)"
fi

# 3) Start web preview (vite preview)
if [ -f "$PIDS_DIR/web.pid" ] && kill -0 "$(cat "$PIDS_DIR/web.pid")" 2>/dev/null; then
  echo "Web preview already running (pid $(cat "$PIDS_DIR/web.pid"))"
else
  echo "Starting web preview..."
  (cd "$REPO/RepoWriter/web" && nohup npm run preview > "$WEB_LOG" 2>&1 & echo $! > "$PIDS_DIR/web.pid")
  echo "Web preview pid $(cat "$PIDS_DIR/web.pid") (logs: $WEB_LOG)"
fi

echo "All started. To stop: run stop_repowriter.sh or use the desktop Stop button."

