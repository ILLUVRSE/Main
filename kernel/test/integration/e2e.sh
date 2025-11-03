#!/usr/bin/env bash
#
# kernel/test/integration/e2e.sh
#
# Minimal end-to-end smoke test for the Kernel service.
# - Exercises health, security/status, sign, division upsert, agent spawn, agent state, eval ingestion, allocation.
# - Optionally inspects audit_events via psql when POSTGRES_URL and psql are available.
#
# Usage:
#   # from ILLUVRSE/Main
#   cd kernel
#   POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/illuvrse PORT=3000 ./test/integration/e2e.sh
#
# Notes:
# - Requires: curl, jq. Optional: psql for audit inspection.
# - This script is intended for local dev/CI smoke tests. It is not a full integration test suite.
set -euo pipefail

# Config
PORT=${PORT:-3000}
HOST=${HOST:-http://localhost}
BASE="${HOST}:${PORT}"
POSTGRES_URL=${POSTGRES_URL:-}
CURL_OPTS="-sS -w \"%{http_code}\" -o /tmp/__e2e_curl_out.json"

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required. Install jq and retry."; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required. Install curl and retry."; exit 2; }

echo "Running Kernel e2e smoke tests against $BASE"

echo
echo "1) Health check"
HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" "${BASE}/health")
if [[ "$HTTP" != "200" ]]; then
  echo "FAIL: /health returned HTTP $HTTP"
  cat /tmp/__e2e_curl_out.json || true
  exit 3
fi
cat /tmp/__e2e_curl_out.json | jq .
echo "OK"

echo
echo "2) Security status"
HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" "${BASE}/kernel/security/status")
if [[ "$HTTP" != "200" ]]; then
  echo "WARN: /kernel/security/status returned HTTP $HTTP (continue if running local dev)"
  cat /tmp/__e2e_curl_out.json || true
else
  cat /tmp/__e2e_curl_out.json | jq .
fi
echo "OK"

# Common test ids
DIVISION_ID="dvg-e2e-test"
AGENT_ID="agent-e2e-1"

echo
echo "3) POST /kernel/sign (sign manifest)"
read -r -d '' MANIFEST_JSON <<EOF || true
{"manifest": {"id":"${DIVISION_ID}","name":"E2E Test Division","goals":["smoke-test"],"budget":1000,"currency":"USD","kpis":["k1"],"policies":[],"version":"1.0.0"}}
EOF

HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "${MANIFEST_JSON}" "${BASE}/kernel/sign")
if [[ "$HTTP" != "200" ]]; then
  echo "FAIL: POST /kernel/sign returned HTTP $HTTP"
  cat /tmp/__e2e_curl_out.json || true
  exit 4
fi
cat /tmp/__e2e_curl_out.json | jq .
# Basic checks
jq -e '.signature and .signer_id' /tmp/__e2e_curl_out.json >/dev/null || { echo "FAIL: /kernel/sign response missing signature/signer_id"; exit 5; }
echo "OK"

echo
echo "4) POST /kernel/division (upsert)"
read -r -d '' DIVISION_BODY <<EOF || true
{"id":"${DIVISION_ID}","name":"E2E Test Division","goals":["smoke-test"],"budget":1000,"currency":"USD","kpis":["k1"],"policies":[],"version":"1.0.0"}
EOF

HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "${DIVISION_BODY}" "${BASE}/kernel/division")
if [[ "$HTTP" != "200" && "$HTTP" != "201" ]]; then
  echo "FAIL: POST /kernel/division returned HTTP $HTTP"
  cat /tmp/__e2e_curl_out.json || true
  exit 6
fi
cat /tmp/__e2e_curl_out.json | jq .
echo "OK"

echo
echo "5) GET /kernel/division/${DIVISION_ID}"
HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" "${BASE}/kernel/division/${DIVISION_ID}")
if [[ "$HTTP" != "200" ]]; then
  echo "FAIL: GET /kernel/division/${DIVISION_ID} returned HTTP $HTTP"
  cat /tmp/__e2e_curl_out.json || true
  exit 7
fi
cat /tmp/__e2e_curl_out.json | jq .
echo "OK"

echo
echo "6) POST /kernel/agent (spawn agent)"
read -r -d '' AGENT_BODY <<EOF || true
{"id":"${AGENT_ID}","templateId":"tmpl-e2e","role":"E2E-Tester","skills":["testing"],"codeRef":"git@github.com:ILLUVRSE/agents.git#e2e","divisionId":"${DIVISION_ID}"}
EOF

HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "${AGENT_BODY}" "${BASE}/kernel/agent")
if [[ "$HTTP" != "201" && "$HTTP" != "200" ]]; then
  echo "FAIL: POST /kernel/agent returned HTTP $HTTP"
  cat /tmp/__e2e_curl_out.json || true
  exit 8
fi
cat /tmp/__e2e_curl_out.json | jq .
echo "OK"

echo
echo "7) GET /kernel/agent/${AGENT_ID}/state"
HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" "${BASE}/kernel/agent/${AGENT_ID}/state")
if [[ "$HTTP" != "200" ]]; then
  echo "FAIL: GET /kernel/agent/${AGENT_ID}/state returned HTTP $HTTP"
  cat /tmp/__e2e_curl_out.json || true
  exit 9
fi
cat /tmp/__e2e_curl_out.json | jq .
echo "OK"

echo
echo "8) POST /kernel/eval (submit evaluation)"
read -r -d '' EVAL_BODY <<EOF || true
{"agent_id":"${AGENT_ID}","metric_set":{"taskSuccess":0.95,"latencyMs":120},"timestamp":"$(date -u +"%Y-%m-%dT%H:%M:%SZ")","source":"e2e-test","computedScore":0.95}
EOF

HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "${EVAL_BODY}" "${BASE}/kernel/eval")
if [[ "$HTTP" != "200" && "$HTTP" != "201" ]]; then
  echo "FAIL: POST /kernel/eval returned HTTP $HTTP"
  cat /tmp/__e2e_curl_out.json || true
  exit 10
fi
cat /tmp/__e2e_curl_out.json | jq .
jq -e '.ok == true and .eval_id' /tmp/__e2e_curl_out.json >/dev/null || { echo "FAIL: /kernel/eval response missing ok:true or eval_id"; exit 11; }
echo "OK"

echo
echo "9) POST /kernel/allocate (request resources)"
read -r -d '' ALLOC_BODY <<EOF || true
{"entity_id":"${DIVISION_ID}","pool":"default","delta":10,"reason":"e2e smoke","requestedBy":"e2e-test"}
EOF

HTTP=$(curl -sS -o /tmp/__e2e_curl_out.json -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "${ALLOC_BODY}" "${BASE}/kernel/allocate")
if [[ "$HTTP" != "200" && "$HTTP" != "201" ]]; then
  echo "FAIL: POST /kernel/allocate returned HTTP $HTTP"
  cat /tmp/__e2e_curl_out.json || true
  exit 12
fi
cat /tmp/__e2e_curl_out.json | jq .
jq -e '.ok == true and .allocation' /tmp/__e2e_curl_out.json >/dev/null || { echo "FAIL: /kernel/allocate response missing ok:true or allocation"; exit 13; }
echo "OK"

echo
echo "10) Audit events inspection (optional via psql)"
if command -v psql >/dev/null 2>&1 && [[ -n "${POSTGRES_URL}" ]]; then
  echo "Querying latest audit events from Postgres..."
  psql "${POSTGRES_URL}" -c "SELECT id, event_type, ts FROM audit_events ORDER BY ts DESC LIMIT 10;"
else
  echo "psql not available or POSTGRES_URL not set; skipping DB audit inspection."
  if [[ -n "${POSTGRES_URL}" ]]; then
    echo "To inspect audits run locally: psql \"${POSTGRES_URL}\" -c \"SELECT id,event_type,ts FROM audit_events ORDER BY ts DESC LIMIT 10;\""
  fi
fi

echo
echo "E2E smoke tests completed successfully."

