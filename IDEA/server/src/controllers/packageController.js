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
