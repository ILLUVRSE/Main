#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/ryanlueckenotte/coder-systems/apps/codex"
SERVER="$ROOT/server"
SCRIPTPATH="$SERVER/scripts/merge-skeleton.sh"
BACKUP_ROOT="$ROOT/_backups"
BACKUP="$BACKUP_ROOT/merge-skeleton-$(date +%s)"

mkdir -p "$BACKUP"
echo "Backing up server -> $BACKUP (rsync, excluding _backups)"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude '_backups' "$SERVER/" "$BACKUP/"
else
  (cd "$SERVER" && tar -cf - --exclude='./_backups' .) | (mkdir -p "$BACKUP" && tar -xf - -C "$BACKUP")
fi

# Copy generated stub controllers from server-stub if present
mkdir -p "$SERVER/src/controllers"
STUB="$ROOT/server-stub"
if [ -d "$STUB/controllers" ]; then
  echo "Copying stub controllers from $STUB/controllers"
  for f in "$STUB/controllers"/*; do
    [ -e "$f" ] || continue
    bn=$(basename "$f")
    if [ -e "$SERVER/src/controllers/$bn" ]; then
      mkdir -p "$BACKUP/src/controllers"
      echo "Backing up existing controller $bn -> $BACKUP/src/controllers/"
      mv "$SERVER/src/controllers/$bn" "$BACKUP/src/controllers/$bn"
    fi
    cp "$f" "$SERVER/src/controllers/$bn"
    echo "Copied $bn"
  done
else
  echo "No $STUB/controllers directory found — continuing"
fi

# Create two minimal controllers (safe placeholders)
cat > "$SERVER/src/controllers/packageController.js" <<'JS'
const express = require('express');
const router = express.Router();

router.post('/package/complete', (req, res) => {
  const { artifact_id, sha256 } = req.body || {};
  if (!artifact_id || !sha256) {
    return res.status(400).json({ ok: false, error: 'artifact_id and sha256 are required' });
  }
  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) {
    return res.status(400).json({ ok: false, error: 'sha256 must be 64 hex characters' });
  }
  return res.json({
    ok: true,
    artifact_url: `s3://local/bundles/${artifact_id}.tgz`,
    sha256
  });
});

module.exports = router;
JS

cat > "$SERVER/src/controllers/sandboxController.js" <<'JS'
const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const router = express.Router();

router.post('/sandbox/run', (req, res) => {
  const run_id = (typeof randomUUID === 'function') ? randomUUID() : require('crypto').randomBytes(16).toString('hex');
  const outDir = path.join(__dirname, '..', '..', 'sandbox_runs');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch(e) {}
  const outFile = path.join(outDir, `${run_id}.json`);
  const queued = { status: 'queued' };
  fs.writeFileSync(outFile, JSON.stringify(queued, null, 2), 'utf8');
  res.status(202).json({ ok: true, run_id, status: 'queued' });
});

module.exports = router;
JS

# Create router aggregator
mkdir -p "$SERVER/src/routes"
cat > "$SERVER/src/routes/idea.js" <<'JS'
const express = require('express');
const router = express.Router();

// Mount the two controllers as routes under /api/v1
router.use('/', require('../controllers/packageController'));
router.use('/', require('../controllers/sandboxController'));

module.exports = router;
JS

# Try to wire into main Express app (best-effort)
MAIN_APP="$(grep -RIl "express()" "$SERVER" | head -n1 || true)"
if [ -z "$MAIN_APP" ]; then
  echo
  echo "WARNING: Could not auto-detect main Express file in $SERVER."
  echo "Please add manually in your main app (before app.listen):"
  echo "  const ideaRoutes = require('./src/routes/idea');"
  echo "  app.use('/api/v1', ideaRoutes);"
else
  echo "Detected main app: $MAIN_APP"
  if ! grep -q "app.use('/api/v1', ideaRoutes)" "$MAIN_APP"; then
    if grep -q "app.listen" "$MAIN_APP" || grep -q "server.listen" "$MAIN_APP"; then
      sed -i "/app.listen/ i \\n// IDEA routes\\ntry { const ideaRoutes = require('./src/routes/idea'); app.use('/api/v1', ideaRoutes); } catch(e) { console.warn('IDEA routes not loaded', e); }\\n" "$MAIN_APP" || true
    else
      printf "\n// IDEA routes\ntry { const ideaRoutes = require('./src/routes/idea'); app.use('/api/v1', ideaRoutes); } catch(e) { console.warn('IDEA routes not loaded', e); }\n" >> "$MAIN_APP"
    fi
    echo "Inserted app.use('/api/v1', ideaRoutes) into $MAIN_APP."
  else
    echo "IDEA routes already registered in $MAIN_APP"
  fi
fi

echo
echo "NOTE: Ensure your main app uses express.json() middleware, e.g.:"
echo "  app.use(express.json());"
echo

mkdir -p "$SERVER/sandbox_runs"

# Restart dev runner: stop anything on port 5175 and start dev
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti :5175 || true)
  if [ -n "$PIDS" ]; then
    echo "Killing processes on :5175 -> $PIDS"
    kill -9 $PIDS || true
  fi
else
  echo "lsof not found; skipping port kill step. If your old server remains running, stop it manually."
fi

echo "Starting dev runner: pnpm -C \"$SERVER\" dev"
pnpm -C "$SERVER" dev &> "$SERVER/_dev.log" &
echo $! > "$SERVER/_dev.pid"
echo "Dev runner started, pid=$(cat "$SERVER/_dev.pid"), logs -> $SERVER/_dev.log"

echo
echo "DONE. Backup is at: $BACKUP"

