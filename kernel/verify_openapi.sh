#!/usr/bin/env bash
# kernel/verify_openapi.sh
# Starts the Kernel server (node dist or ts-node), waits for /health,
# then hits /ready and exercises /kernel/division with invalid/valid payloads.
# Usage:
#   ./verify_openapi.sh               # uses PORT or 3000
#   PORT=8080 ./verify_openapi.sh     # target custom port
#   ./verify_openapi.sh http://localhost:3000  # explicit base URL

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

OPENAPI_PATH="./openapi.yaml"
SERVER_PID=""

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "Shutting down Kernel server (pid $SERVER_PID)..."
    kill "$SERVER_PID" || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ ! -f "$OPENAPI_PATH" ]; then
  echo "ERROR: $OPENAPI_PATH not found. Create kernel/openapi.yaml first."
  exit 2
fi

# Respect explicit URL arg or PORT env; default to 3000
BASE_URL="${1:-http://localhost:${PORT:-3000}}"
HEALTH_URL="${BASE_URL%/}/health"
READY_URL="${BASE_URL%/}/ready"

echo "Starting Kernel server in dev mode (REQUIRE_KMS=false, OPENAPI_PATH=$OPENAPI_PATH)..."
# prefer a built JS server if present; otherwise use ts-node
if [ -f "dist/server.js" ]; then
  NODE_ENV=development REQUIRE_KMS=false OPENAPI_PATH="$OPENAPI_PATH" node dist/server.js &
  SERVER_PID=$!
elif command -v npx >/dev/null 2>&1 && [ -f "src/server.ts" ]; then
  NODE_ENV=development REQUIRE_KMS=false OPENAPI_PATH="$OPENAPI_PATH" \
    npx ts-node --transpile-only src/server.ts &
  SERVER_PID=$!
else
  echo "ERROR: cannot find dist/server.js or src/server.ts with npx available."
  echo "Install dependencies and/or build the kernel. Example:"
  echo "  cd kernel && npm install"
  exit 3
fi

echo "Kernel server started with pid $SERVER_PID. Waiting for /health..."

# wait up to 30s for /health
MAX_WAIT=30
i=0
while [ $i -lt $MAX_WAIT ]; do
  if curl -sSf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "  /health responded."
    break
  fi
  i=$((i+1))
  sleep 1
done

if [ $i -ge $MAX_WAIT ]; then
  echo "ERROR: /health did not respond within ${MAX_WAIT}s. Check server logs above."
  exit 4
fi

echo
echo "Querying /health:"
curl -sS "$HEALTH_URL" | { command -v jq >/dev/null 2>&1 && jq . || cat; }

echo
echo "Querying /ready (may return 503 if DB/KMS not configured):"
curl -s -i "$READY_URL" || true

echo
echo "Testing OpenAPI validation with invalid payload (expected HTTP 400)."
INVALID_PAYLOAD='{}'
RESP_FILE=$(mktemp)
HTTP_CODE=$(curl -s -o "$RESP_FILE" -w "%{http_code}" -X POST \
  "${BASE_URL%/}/kernel/division" \
  -H "Content-Type: application/json" \
  -d "$INVALID_PAYLOAD" || true)

echo "Response HTTP code: $HTTP_CODE"
echo "Response body:"
cat "$RESP_FILE" || true
echo

if [ "$HTTP_CODE" = "400" ]; then
  echo "Good: OpenAPI validation appears active (400 for invalid payload)."
else
  echo "Warning: expected 400 for invalid payload but got $HTTP_CODE."
  echo "This may mean OpenAPI validator is not installed or the schema allowed the payload."
fi

echo
echo "Testing OpenAPI with a valid DivisionManifest (expected HTTP 200)."
VALID_PAYLOAD='{
  "id":"00000000-0000-0000-0000-000000000001",
  "name":"test-division",
  "goals":["initial"],
  "budget":1000,
  "kpis":[],
  "policies":[],
  "metadata":{}
}'
RESP_FILE_VALID=$(mktemp)
HTTP_CODE_VALID=$(curl -s -o "$RESP_FILE_VALID" -w "%{http_code}" -X POST \
  "${BASE_URL%/}/kernel/division" \
  -H "Content-Type: application/json" \
  -d "$VALID_PAYLOAD" || true)

echo "Response HTTP code: $HTTP_CODE_VALID"
echo "Response body:"
cat "$RESP_FILE_VALID" || true
echo

if [ "$HTTP_CODE_VALID" = "200" ] || [ "$HTTP_CODE_VALID" = "201" ] || [ "$HTTP_CODE_VALID" = "202" ]; then
  echo "OK: server accepted a valid DivisionManifest (status $HTTP_CODE_VALID)."
else
  echo "Warning: expected 200/202 for valid payload but got $HTTP_CODE_VALID."
fi

echo
echo "Finished verification. Server logs (if any) printed above."
# cleanup will run via trap
EOF

