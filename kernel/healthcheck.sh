#!/usr/bin/env bash
# kernel/healthcheck.sh
#
# Container health/readiness probe for the Kernel service.
# - Checks Postgres connectivity (required).
# - Optionally checks KMS endpoint (if KMS_ENDPOINT is set).
# - Exits 0 on success, non-zero on failure.
#
# Usage:
#   POSTGRES_URL=postgresql://... KMS_ENDPOINT=https://kms.example ./kernel/healthcheck.sh
#
# Exit codes:
#   0 = healthy
#   2 = missing POSTGRES_URL
#   3 = Postgres check failed
#   4 = KMS check failed
#   1 = unexpected error
#
set -euo pipefail

echo "[healthcheck] starting health check"

if [[ -z "${POSTGRES_URL:-}" ]]; then
  echo "[healthcheck] ERROR: POSTGRES_URL is not set"
  exit 2
fi

# Run a small Node.js healthcheck inline so we rely on the same runtime deps as the app.
# This script uses the 'pg' library (should be present in production deps) and global fetch.
node <<'NODE'
const { Client } = require('pg');

(async () => {
  const pgUrl = process.env.POSTGRES_URL;
  const kms = process.env.KMS_ENDPOINT || null;

  if (!pgUrl) {
    console.error('[healthcheck] ERROR: POSTGRES_URL not set (node)');
    process.exit(2);
  }

  // 1) Check Postgres connectivity
  const client = new Client({ connectionString: pgUrl });
  try {
    await client.connect();
    // Run a lightweight query
    const res = await client.query('SELECT 1');
    if (!res || !res.rows) {
      console.error('[healthcheck] ERROR: unexpected DB response', res);
      await client.end().catch(() => {});
      process.exit(3);
    }
    console.log('[healthcheck] db: OK');
  } catch (err) {
    console.error('[healthcheck] db: ERROR', err && err.message ? err.message : err);
    try { await client.end(); } catch (_) {}
    process.exit(3);
  } finally {
    try { await client.end(); } catch (_) {}
  }

  // 2) Optional KMS check (if configured)
  if (kms) {
    try {
      // Use global fetch (Node 18+). Abort if not responding quickly.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(kms, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      // Accept any 2xx/3xx/4xx as reachable — the point is connectivity. Treat network errors as failure.
      console.log('[healthcheck] kms: reachable (status=' + resp.status + ')');
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      console.error('[healthcheck] kms: ERROR', msg);
      process.exit(4);
    }
  } else {
    console.log('[healthcheck] kms: skipped (KMS_ENDPOINT not configured)');
  }

  console.log('[healthcheck] all checks passed');
  process.exit(0);
})();
NODE

# If Node returns 0, script exits 0 here.

