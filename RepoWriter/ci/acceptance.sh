#!/usr/bin/env bash
set -euo pipefail

# RepoWriter acceptance script (CI)
# - starts a signing-proxy mock and a minimal OpenAI mock
# - builds the server, starts it with a temp git repo
# - calls /api/openai/plan, /api/openai/apply (dry), /api/openai/apply (apply)
# - verifies a commit with the 'repowriter:' prefix was created
#
# Notes:
# - This is intentionally self-contained for CI.
# - Requires: node, npm, git, jq (available on GitHub runners).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$ROOT/RepoWriter/server"
PORT=7071
SIGNER_PORT=18080
OPENAI_PORT=9876

echo "Root: $ROOT"
echo "Server dir: $SERVER_DIR"
echo "Using PORT=$PORT SIGNER_PORT=$SIGNER_PORT OPENAI_PORT=$OPENAI_PORT"

# create a temp git repo
REPO_PATH="$(mktemp -d -t repowriter-repo-XXXX)"
echo "Using temporary REPO_PATH=$REPO_PATH"

# prepare repo
git init "$REPO_PATH" >/dev/null 2>&1 || true
cd "$REPO_PATH"
git config user.email "test@example.com"
git config user.name "RepoWriter CI"
echo "initial" > README.md
git add README.md
git commit -m "initial" || true
cd "$ROOT"

# write signing-proxy mock to temp file
SIGNER_JS="/tmp/repowriter_signing_proxy.js"
cat > "$SIGNER_JS" <<'NODE'
const http = require('http');
const port = parseInt(process.env.SIGNER_PORT || '18080', 10);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/sign') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const payload_b64 = j.payload_b64 || '';
        const signature = Buffer.from('signed-by-mock:' + payload_b64).toString('base64');
        const signer_id = 'mock-signer-1';
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ signature_b64: signature, signer_id }));
      } catch (e) {
        res.writeHead(400); res.end('bad request');
      }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
}).listen(port, '127.0.0.1', () => console.log('signing-proxy mock listening on', port));
NODE

node "$SIGNER_JS" &>/tmp/signing-proxy.log &
SIGNER_PID=$!
echo "Started signing-proxy mock (pid=$SIGNER_PID), logs: /tmp/signing-proxy.log"

# write openai mock
OPENAI_JS="/tmp/repowriter_openai_mock.js"
cat > "$OPENAI_JS" <<'NODE'
const http = require('http');
const port = parseInt(process.env.OPENAI_PORT || '9876', 10);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      // Return deterministic plan embedded in the content field
      const plan = { plan: { steps: [ { explanation: 'Create smoke file', patches: [ { path: 'smoke.txt', content: 'smoke' } ] } ] } };
      const content = JSON.stringify(plan);
      const response = { choices: [ { message: { content } } ] };
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(response));
    });
    return;
  }
  // health
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404); res.end('not found');
}).listen(port, '127.0.0.1', () => console.log('openai-mock listening on', port));
NODE

node "$OPENAI_JS" &>/tmp/openai-mock.log &
OPENAI_PID=$!
echo "Started openai mock (pid=$OPENAI_PID), logs: /tmp/openai-mock.log"

# build server
cd "$SERVER_DIR"
echo "Installing server deps..."
npm ci --no-audit --no-fund
echo "Building server..."
npm run build

# start server
export SIGNING_PROXY_URL="http://127.0.0.1:$SIGNER_PORT"
export SIGNING_PROXY_API_KEY="mock"
export REQUIRE_SIGNING_PROXY=1
export OPENAI_API_URL="http://127.0.0.1:$OPENAI_PORT"
export OPENAI_API_KEY=""
export REPO_PATH="$REPO_PATH"
export PORT="$PORT"
export NODE_ENV="development"  # we use development so hot reload doesn't change behavior, but REQUIRE_SIGNING_PROXY enforces signing

echo "Starting server (node dist/index.js)..."
node dist/index.js &>/tmp/repowriter-server.log &
SERVER_PID=$!
echo "Server pid $SERVER_PID (logs: /tmp/repowriter-server.log)"

# wait for health
echo "Waiting for server health..."
for i in $(seq 1 30); do
  if curl -sS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 || curl -sS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "server healthy"
    break
  fi
  sleep 1
done

# Plan
echo "Calling /api/openai/plan ..."
PLAN_RESP=$(curl -sS -X POST "http://127.0.0.1:$PORT/api/openai/plan" -H 'Content-Type: application/json' -d '{"prompt":"Create a smoke file","memory":[]}') || true
echo "Plan response: $PLAN_RESP"
if [ -z "$PLAN_RESP" ]; then
  echo "Plan failed (empty response)"
  exit 1
fi

# Try to extract patches (support two possible shapes)
PATCHES=$(echo "$PLAN_RESP" | jq -c '.plan.steps[0].patches // .steps[0].patches' 2>/dev/null || true)
if [ -z "$PATCHES" ] || [ "$PATCHES" = "null" ]; then
  echo "No patches found in plan: $PLAN_RESP"
  exit 1
fi
echo "Patches: $PATCHES"

# Dry-run
echo "Calling /api/openai/apply (dry) ..."
DRY_RESP=$(curl -sS -X POST "http://127.0.0.1:$PORT/api/openai/apply" -H 'Content-Type: application/json' -d "{\"patches\":$PATCHES,\"mode\":\"dry\"}") || true
echo "Dry response: $DRY_RESP"

# Apply
echo "Calling /api/openai/apply (apply) ..."
APPLY_RESP=$(curl -sS -X POST "http://127.0.0.1:$PORT/api/openai/apply" -H 'Content-Type: application/json' -d "{\"patches\":$PATCHES,\"mode\":\"apply\"}") || true
echo "Apply response: $APPLY_RESP"

# Validate a commit with repowriter: prefix exists
cd "$REPO_PATH"
LOGS=$(git log -n 5 --pretty=format:%s || true)
echo "Recent commits:"
echo "$LOGS"
if echo "$LOGS" | grep -q "repowriter:"; then
  echo "Commit created with repowriter: prefix — OK"
else
  echo "No repowriter: commit found — FAIL"
  echo "Server log:"
  tail -n 200 /tmp/repowriter-server.log || true
  exit 1
fi

# cleanup & success
echo "Acceptance checks passed."

# kill background processes
kill "$SERVER_PID" || true
kill "$SIGNER_PID" || true
kill "$OPENAI_PID" || true

# remove temp repo
rm -rf "$REPO_PATH" || true

exit 0

