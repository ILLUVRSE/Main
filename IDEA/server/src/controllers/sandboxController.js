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

