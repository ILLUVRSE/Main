// agent-manager/server/middleware/signatureVerify.js
//
// Middleware to verify Kernel callback signatures and protect against replay.
// Uses DB-backed kernel_nonces (via ../db) and fetches kernel public keys
// via the centralized key_store (../key_store).
//
// Usage:
//   const signatureVerify = require('./middleware/signatureVerify');
//   app.post('/api/v1/kernel/callback', bodyParser.json({verify: captureRaw}), signatureVerify(), handler);

const crypto = require('crypto');
const db = require('../db');
const keyStore = require('../key_store');

const DEFAULT_SKEW_SECONDS = 120; // +- allowed timestamp skew
const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isHexString(s) {
  return /^[0-9a-fA-F]+$/.test(s);
}

function constantTimeEqual(aBuf, bBuf) {
  if (!Buffer.isBuffer(aBuf)) aBuf = Buffer.from(aBuf);
  if (!Buffer.isBuffer(bBuf)) bBuf = Buffer.from(bBuf);
  try {
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch (e) {
    return false;
  }
}

/* Key map cache backed by key_store.getKernelPublicKeys() */
let KEY_MAP_CACHE = { keys: {}, fetchedAt: 0 };
async function getKeyMapFromKeyStore(opts = {}) {
  const now = Date.now();
  const ttl = opts.keyCacheTtlMs || DEFAULT_KEY_CACHE_TTL_MS;
  if (KEY_MAP_CACHE.fetchedAt && (now - KEY_MAP_CACHE.fetchedAt) < ttl) return KEY_MAP_CACHE.keys;

  try {
    const keys = await keyStore.getKernelPublicKeys();
    KEY_MAP_CACHE = { keys: keys || {}, fetchedAt: Date.now() };
    return KEY_MAP_CACHE.keys;
  } catch (e) {
    console.warn('getKernelPublicKeys failed', e && e.message ? e.message : e);
    KEY_MAP_CACHE = { keys: {}, fetchedAt: Date.now() };
    return {};
  }
}

function parseSignatureHeader(header) {
  // Accepts:
  //  - 'sha256=<hex>' (HMAC shorthand)
  //  - 'kid=<kid>;alg=<alg>;sig=<b64orhex>'
  //  - possibly comma-separated entries (we'll use the first recognized)
  if (!header || typeof header !== 'string') return null;

  // try simple pattern: sha256=hex
  const simpleMatch = header.match(/^\s*sha256=([0-9a-fA-F]+)\s*$/i);
  if (simpleMatch) {
    return { alg: 'hmac-sha256', sig: simpleMatch[1], kid: 'shared', sigEncoding: 'hex' };
  }

  // try key-value pairs separated by ';' or ','
  const parts = header.split(/[;,]/).map(p => p.trim()).filter(Boolean);
  const kv = {};
  for (const p of parts) {
    const [k, v] = p.split('=').map(s => s && s.trim());
    if (k && v) kv[k] = v;
  }
  if (!kv.sig && kv.signature) kv.sig = kv.signature;
  if (!kv.kid && kv.keyid) kv.kid = kv.keyid;
  if (kv.kid && kv.alg && kv.sig) {
    const sigEncoding = isHexString(kv.sig) ? 'hex' : 'base64';
    return { kid: kv.kid, alg: kv.alg.toLowerCase(), sig: kv.sig, sigEncoding };
  }

  // unknown format
  return null;
}

async function verifySignatureOnBody({ bodyBuffer, alg, keyMaterial, signature, sigEncoding }) {
  if (!bodyBuffer) bodyBuffer = Buffer.from('');
  if (!alg) throw new Error('alg required');
  alg = alg.toLowerCase();

  // normalize signature Buffer
  let sigBuf;
  if (sigEncoding === 'hex' || isHexString(String(signature))) {
    try { sigBuf = Buffer.from(String(signature), 'hex'); } catch (e) { sigBuf = Buffer.from(String(signature)); }
  } else {
    // assume base64
    try { sigBuf = Buffer.from(String(signature), 'base64'); } catch (e) { sigBuf = Buffer.from(String(signature)); }
  }

  if (alg === 'hmac-sha256' || alg === 'sha256') {
    if (!keyMaterial) throw new Error('missing shared secret for hmac');
    const mac = crypto.createHmac('sha256', keyMaterial).update(bodyBuffer).digest('hex');
    if (sigBuf.length === Buffer.from(mac, 'hex').length) {
      return constantTimeEqual(Buffer.from(mac, 'hex'), sigBuf);
    }
    return constantTimeEqual(Buffer.from(mac, 'hex').toString('hex'), sigBuf.toString('hex'));
  }

  if (alg === 'rsa-sha256' || alg === 'rsa' || alg === 'rsa-sha2-256') {
    if (!keyMaterial) throw new Error('missing RSA public key');
    try {
      return crypto.verify('sha256', bodyBuffer, keyMaterial, sigBuf);
    } catch (e) {
      return crypto.verify('RSA-SHA256', bodyBuffer, keyMaterial, sigBuf);
    }
  }

  if (alg === 'ed25519' || alg === 'ed25519-sha') {
    if (!keyMaterial) throw new Error('missing ed25519 public key');
    try {
      return crypto.verify(null, bodyBuffer, keyMaterial, sigBuf);
    } catch (e) {
      try {
        return crypto.verify('ed25519', bodyBuffer, keyMaterial, sigBuf);
      } catch (e2) {
        throw e;
      }
    }
  }

  throw new Error(`unsupported alg: ${alg}`);
}

/**
 * Factory: returns middleware function
 * opts:
 *  - allowedSkewSec: allowed timestamp skew in seconds (default 120)
 *  - nonceTtlMs: nonce TTL in ms (default 300000)
 *  - keyCacheTtlMs: key cache TTL in ms
 *  - getKeyMap: optional async function returning { kid -> { alg, key } }
 */
function signatureVerify(opts = {}) {
  const allowedSkew = opts.allowedSkewSec || DEFAULT_SKEW_SECONDS;
  const nonceTtlMs = opts.nonceTtlMs || DEFAULT_NONCE_TTL_MS;

  // allow custom keyMap fetcher; default uses key_store
  const getKeyMap = opts.getKeyMap || (async () => getKeyMapFromKeyStore(opts));

  return async function (req, res, next) {
    try {
      const sigHeader = req.get('X-Kernel-Signature') || req.get('x-kernel-signature');
      const tsHeader = req.get('X-Kernel-Timestamp') || req.get('x-kernel-timestamp');
      const nonceHeader = req.get('X-Kernel-Nonce') || req.get('x-kernel-nonce');

      if (!sigHeader || !tsHeader || !nonceHeader) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'missing required kernel security headers' }});
      }

      // timestamp check
      const ts = Number(tsHeader);
      if (Number.isNaN(ts)) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'invalid X-Kernel-Timestamp' }});
      }
      const now = nowSeconds();
      if (Math.abs(now - ts) > allowedSkew) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'X-Kernel-Timestamp outside allowed skew' }});
      }

      // --- DB-backed nonce replay protection (try-insert pattern) ---
      const expiresAtIso = new Date(Date.now() + nonceTtlMs).toISOString();

      let inserted = null;
      try {
        inserted = await db.insertKernelNonce(nonceHeader, expiresAtIso, null);
      } catch (e) {
        console.error('insertKernelNonce error', e);
        return res.status(500).json({ ok: false, error: { code: 'server_error', message: 'nonce storage error' }});
      }

      if (!inserted) {
        let replay;
        try {
          replay = await db.isKernelNonceReplay(nonceHeader);
        } catch (e) {
          console.error('isKernelNonceReplay error', e);
          return res.status(500).json({ ok: false, error: { code: 'server_error', message: 'nonce check error' }});
        }

        if (replay) {
          return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'replayed X-Kernel-Nonce' }});
        }

        try {
          const qRes = await db.query(
            `UPDATE kernel_nonces
             SET expires_at = $2, created_at = now(), consumed_at = NULL, consumed_by = NULL
             WHERE nonce = $1
             RETURNING id, nonce, agent_id, created_at, expires_at, consumed_at, consumed_by`,
            [nonceHeader, expiresAtIso]
          );
          if (!qRes.rows[0]) {
            const reinserted = await db.insertKernelNonce(nonceHeader, expiresAtIso, null);
            if (!reinserted) {
              return res.status(500).json({ ok: false, error: { code: 'server_error', message: 'nonce refresh failed' }});
            }
          }
        } catch (e) {
          console.error('nonce refresh error', e);
          return res.status(500).json({ ok: false, error: { code: 'server_error', message: 'nonce refresh failed' }});
        }
      }

      // determine body buffer
      let bodyBuffer = req.rawBody;
      if (!bodyBuffer) {
        try {
          bodyBuffer = Buffer.from(JSON.stringify(req.body || {}), 'utf8');
        } catch (e) {
          bodyBuffer = Buffer.from('');
        }
      }

      // parse signature header
      const parsed = parseSignatureHeader(sigHeader);
      if (!parsed) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'invalid X-Kernel-Signature format' }});
      }

      // obtain key map and pick key
      const keyMap = await getKeyMap();
      const kid = parsed.kid || 'shared';
      const alg = parsed.alg || (parsed && parsed.alg) || 'hmac-sha256';
      let keyEntry = keyMap[kid];

      // fallback: if kid === 'shared' and KERNEL_SHARED_SECRET exists
      if (!keyEntry && kid === 'shared' && process.env.KERNEL_SHARED_SECRET) {
        keyEntry = { alg: 'hmac-sha256', key: process.env.KERNEL_SHARED_SECRET };
      }

      if (!keyEntry) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: `unknown key id ${kid}` }});
      }

      // verify signature
      const verified = await verifySignatureOnBody({
        bodyBuffer,
        alg: alg.toLowerCase(),
        keyMaterial: keyEntry.key,
        signature: parsed.sig,
        sigEncoding: parsed.sigEncoding || (isHexString(parsed.sig) ? 'hex' : 'base64')
      });

      if (!verified) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'invalid signature' }});
      }

      // mark consumed (best-effort)
      try {
        await db.consumeKernelNonce(nonceHeader, 'kernel-callback');
      } catch (e) {
        console.error('consumeKernelNonce error', e);
      }

      // attach signature metadata to request for handlers
      req.kernelSignature = { kid, alg: alg.toLowerCase(), verified: true, timestamp: ts, nonce: nonceHeader };

      return next();
    } catch (err) {
      console.error('signatureVerify error', err);
      return res.status(500).json({ ok: false, error: { code: 'server_error', message: 'signature verification failed' }});
    }
  };
}

module.exports = signatureVerify;

/* ---------------------------------------------------------------------------
   Quick self-test (HMAC / DB flow)
   Usage:
     From agent-manager directory:
     DATABASE_URL="postgres://username:password@localhost:5432/agent_manager_db" \
     KERNEL_SHARED_SECRET: "<REPLACE_WITH_SECRET_FROM_ENV>" \
     node server/middleware/signatureVerify.js
-----------------------------------------------------------------------------*/
if (require.main === module) {
  (async () => {
    try {
      await db.init();
      console.log('DB OK');

      const factory = signatureVerify();

      const body = { test: 'hello' };
      const bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');

      const ts = Math.floor(Date.now() / 1000);
      const nonce = 'sigtest-' + Date.now();

      const secret = process.env.KERNEL_SHARED_SECRET;
      if (!secret) {
        console.error('Please set KERNEL_SHARED_SECRET for the quick test.');
        process.exit(1);
      }

      const mac = crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex');
      const sigHeader = 'sha256=' + mac;

      const headers = {
        'x-kernel-signature': sigHeader,
        'x-kernel-timestamp': String(ts),
        'x-kernel-nonce': nonce
      };

      // minimal req/res/next mocks
      const req = {
        get: (name) => headers[name.toLowerCase()],
        rawBody: bodyBuffer,
        body: body
      };

      const res = {
        status: function(code) { this._code = code; return this; },
        json: function(obj) { console.log('RES JSON', this._code, obj); return this; }
      };

      await new Promise((resolve) => {
        factory(req, res, () => {
          console.log('middleware passed; req.kernelSignature=', req.kernelSignature);
          resolve();
        });
      });

    } catch (e) {
      console.error('SELFTEST ERROR', e);
      process.exit(2);
    } finally {
      try { await db.close(); } catch (e) {}
      process.exit(0);
    }
  })();
}

