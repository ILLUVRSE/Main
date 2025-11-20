#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${MOCK_API_PORT:-4001}"

export NEXT_PUBLIC_API_BASE_URL="http://localhost:${API_PORT}"

echo "Starting Illuvrse mock API on port ${API_PORT}…"
node "${ROOT_DIR}/mock-api/server.js" &
API_PID=$!

cleanup() {
  echo "Shutting down mock API (pid ${API_PID})"
  kill "${API_PID}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "Starting Next.js dev server with NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}"
cd "${ROOT_DIR}"
npm run dev
