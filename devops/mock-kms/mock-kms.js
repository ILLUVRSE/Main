// devops/mock-kms/mock-kms.js
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const SECRET = process.env.MOCK_KMS_SECRET || 'mock-secret-key';
const APP = express();
APP.use(bodyParser.json({ limit: '1mb' }));

APP.get('/ready', (_req, res) => res.json({ ready: true }));

// sign a hex digest: { digestHex: "abcd..." }
// returns { kid, alg, signature }
APP.post('/sign/hash', (req, res) => {
  try {
    const { digestHex } = req.body || {};
    if (!digestHex || typeof digestHex !== 'string') {
      return res.status(400).json({ error: 'digestHex required' });
    }
    // HMAC-SHA256 mock
    const h = crypto.createHmac('sha256', SECRET);
    // Interpret digestHex as bytes
    const buf = Buffer.from(digestHex, 'hex');
    h.update(buf);
    const sig = h.digest('base64');
    return res.json({ kid: 'mock-kms-key', alg: 'hmac-sha256', signature: sig });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// verify: { digestHex, signature }
APP.post('/verify', (req, res) => {
  try {
    const { digestHex, signature } = req.body || {};
    if (!digestHex || !signature) return res.status(400).json({ error: 'digestHex and signature required' });
    const h = crypto.createHmac('sha256', SECRET);
    const buf = Buffer.from(digestHex, 'hex');
    h.update(buf);
    const expected = h.digest('base64');
    return res.json({ valid: expected === signature });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

APP.listen(PORT, () => {
  console.log(`mock-kms listening on ${PORT} (SECRET=${SECRET.slice(0,6)}...)`);
});

