// agent-manager/server/middleware/signatureVerify.js
//
// Middleware to verify Kernel callback signatures and protect against replay.
// Usage:
//   const signatureVerify = require('./middleware/signatureVerify');
//   app.post('/api/v1/kernel/callback', bodyParser.json({verify: captureRaw}), signatureVerify(), handler);
//
// Environment / options supported:
// - KERNEL_SHARED_SECRET: if present, used for HMAC-SHA256 fallback (sha256=... header).
// - KERNEL_PUBLIC_KEYS_JSON: JSON string mapping kid -> { alg: "ed25519"|"rsa-sha256"|"hmac-sha256", key: "<PEM or secret>" }
// - KERNEL_PUBLIC_KEYS_URL: URL returning same JSON shape (auto-fetched and cached).
//
// Notes:
// - This middleware uses an in-memory nonce cache (default TTL 300s). Replace with DB-backed store for production.
// - It expects the raw request bytes to be available on `req.rawBody`. See `server/index.js` notes below.

const crypto = require('crypto');

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

// Simple in-memory nonce store with TTL
const NONCE_STORE = new Map();
function isReplay(nonce, ttlMs = DEFAULT_NONCE_TTL_MS) {
  const entry = NONCE_STORE.get(nonce);
  if (!entry) return false;
  if (Date.now() > entry.expires) {
    NONCE_STORE.delete(nonce);
    return false;
  }
  return true;
}
function recordNonce(nonce, ttlMs = DEFAULT_NONCE_TTL_MS) {
  NONCE_STORE.set(nonce, { expires: Date.now() + ttlMs });
  // lazy cleanup (not necessary for small dev workloads)
  setTimeout(() => {
    const e = NONCE_STORE.get(nonce);
    if (e && Date.now() > e.expires) NONCE_STORE.delete(nonce);
  }, ttlMs + 1000);
}

// Key cache
let KEY_CACHE = { keys: {}, fetchedAt: 0 };
async function getKeyMapFromEnvOrUrl(opts = {}) {
  const now = Date.now();
  const ttl = opts.keyCacheTtlMs || DEFAULT_KEY_CACHE_TTL_MS;
  if (KEY_CACHE.fetchedAt && (now - KEY_CACHE.fetchedAt) < ttl) return KEY_CACHE.keys;

  // 1) KERNEL_PUBLIC_KEYS_JSON
  if (process.env.KERNEL_PUBLIC_KEYS_JSON) {
    try {
      const parsed = JSON.parse(process.env.KERNEL_PUBLIC_KEYS_JSON);
      KEY_CACHE = { keys: parsed, fetchedAt: Date.now() };
      return parsed;
    } catch (e) {
      // fallthrough
      console.warn('KERNEL_PUBLIC_KEYS_JSON parse failed', e.message);
    }
  }

  // 2) KERNEL_PUBLIC_KEYS_URL
  if (process.env.KERNEL_PUBLIC_KEYS_URL && typeof globalThis.fetch === 'function') {
    try {
      const resp = await fetch(process.env.KERNEL_PUBLIC_KEYS_URL);
      if (resp.ok) {
        const json = await resp.json();
        KEY_CACHE = { keys: json, fetchedAt: Date.now() };
        return json;
      } else {
        throw new Error(`failed fetching keys: ${resp.status}`);
      }
    } catch (e) {
      console.warn('KERNEL_PUBLIC_KEYS_URL fetch failed', e.message);
    }
  }

  // 3) fallback: if KERNEL_SHARED_SECRET present expose as implicit key 'shared'
  if (process.env.KERNEL_SHARED_SECRET) {
    const m = { shared: { alg: 'hmac-sha256', key: process.env.KERNEL_SHARED_SECRET } };
    KEY_CACHE = { keys: m, fetchedAt: Date.now() };
    return m;
  }

  // empty
  KEY_CACHE = { keys: {}, fetchedAt: Date.now() };
  return {};
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
    // compare hex string with hex sig or compare buffers
    if (sigBuf.length === Buffer.from(mac, 'hex').length) {
      return constantTimeEqual(Buffer.from(mac, 'hex'), sigBuf);
    }
    return constantTimeEqual(Buffer.from(mac, 'hex').toString('hex'), sigBuf.toString('hex'));
  }

  if (alg === 'rsa-sha256' || alg === 'rsa' || alg === 'rsa-sha2-256') {
    if (!keyMaterial) throw new Error('missing RSA public key');
    // keyMaterial expected PEM public key
    // use crypto.verify with sha256
    try {
      return crypto.verify('sha256', bodyBuffer, keyMaterial, sigBuf);
    } catch (e) {
      // older node or format issues: try different invocation
      return crypto.verify('RSA-SHA256', bodyBuffer, keyMaterial, sigBuf);
    }
  }

  if (alg === 'ed25519' || alg === 'ed25519-sha') {
    if (!keyMaterial) throw new Error('missing ed25519 public key');
    // For ed25519, node supports verify(null, data, key, signature)
    try {
      return crypto.verify(null, bodyBuffer, keyMaterial, sigBuf);
    } catch (e) {
      // fallback: try 'ed25519' as algorithm
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

  // allow custom keyMap fetcher
  const getKeyMap = opts.getKeyMap || (async () => getKeyMapFromEnvOrUrl(opts));

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

      // nonce replay protection
      if (isReplay(nonceHeader, nonceTtlMs)) {
        return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'replayed X-Kernel-Nonce' }});
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

      // determine body buffer
      let bodyBuffer = req.rawBody;
      if (!bodyBuffer) {
        // fallback to canonical JSON stringification (not ideal for prod)
        try {
          bodyBuffer = Buffer.from(JSON.stringify(req.body || {}), 'utf8');
        } catch (e) {
          bodyBuffer = Buffer.from('');
        }
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

      // record nonce to prevent replay
      recordNonce(nonceHeader, nonceTtlMs);

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

