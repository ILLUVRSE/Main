#!/usr/bin/env node
/**
 * marketplace/mocks/signerMock.js
 *
 * Simple signing-proxy mock for local development.
 * - POST /sign   { digest_hex, algorithm? , canonical_payload? } -> { signature: base64, signer_kid }
 * - POST /verify { digest_hex, signature_b64 } -> { verified: true|false }
 * - GET  /health -> { ok: true }
 *
 * Notes:
 * - This mock is for dev/testing only. It generates an ephemeral RSA keypair on start.
 * - For canonical_payload signing, the proxy will sign the UTF-8 bytes of the canonical_payload string.
 * - For digest_hex signing, the proxy will sign the raw digest bytes (with createSign('sha256') hashing the bytes again;
 *   this is acceptable for development/testing).
 */

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.SIGNING_PROXY_PORT || process.env.PORT || 7000);
const SIGNER_KID = process.env.SIGNER_MOCK_KID || 'signer-mock-1';

// Generate ephemeral RSA keypair (2048)
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 0x10001,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

console.log(`[signerMock] Starting signer mock on port ${PORT}`);
console.log(`[signerMock] Signer KID: ${SIGNER_KID}`);

// Helper: parse JSON body
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 1e6) {
        // too big
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve(null);
      try {
        const js = JSON.parse(data);
        resolve(js);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Sign helper
function signPayload({ digest_hex, canonical_payload, algorithm }) {
  // algorithm is ignored for mock apart from optional PSS vs PKCS1 selection; default to PKCS1 v1.5
  const usePss = (algorithm || '').toUpperCase().includes('PSS');
  // We will sign either the canonical_payload bytes (preferred) or the digest bytes.
  let inputBuf;
  if (canonical_payload) {
    inputBuf = Buffer.from(String(canonical_payload), 'utf8');
  } else if (digest_hex) {
    // interpret as hex
    inputBuf = Buffer.from(String(digest_hex), 'hex');
  } else {
    throw new Error('Either canonical_payload or digest_hex must be provided');
  }

  // Use node's Sign which hashes the input; acceptable for dev/test
  const signer = crypto.createSign('sha256');
  signer.update(inputBuf);
  signer.end();
  const signOpts = usePss
    ? {
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      }
    : undefined;
  const sig = signer.sign({ key: privateKey, ...(signOpts || {}) });
  return { signatureB64: sig.toString('base64'), signer_kid: SIGNER_KID, algorithm: usePss ? 'RSASSA_PSS_SHA_256' : 'RSASSA_PKCS1_V1_5_SHA_256' };
}

// Verify helper
function verifySignature({ digest_hex, canonical_payload, signature_b64, algorithm }) {
  if (!signature_b64) return false;
  let inputBuf;
  if (canonical_payload) {
    inputBuf = Buffer.from(String(canonical_payload), 'utf8');
  } else if (digest_hex) {
    inputBuf = Buffer.from(String(digest_hex), 'hex');
  } else {
    throw new Error('Either canonical_payload or digest_hex must be provided to verify');
  }

  const verifier = crypto.createVerify('sha256');
  verifier.update(inputBuf);
  verifier.end();
  const sigBuf = Buffer.from(signature_b64, 'base64');
  const usePss = (algorithm || '').toUpperCase().includes('PSS');
  const verifyOpts = usePss
    ? {
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      }
    : undefined;
  try {
    return verifier.verify({ key: publicKey, ...(verifyOpts || {}) }, sigBuf);
  } catch (e) {
    console.debug('[signerMock] verification error', e && e.message ? e.message : e);
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, signer_kid: SIGNER_KID }));
    return;
  }

  if (req.method === 'POST' && (url === '/sign' || url === '/verify')) {
    try {
      const body = await readJson(req);
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing body' }));
        return;
      }

      if (url === '/sign') {
        // Accept either digest_hex or canonical_payload
        const { digest_hex, canonical_payload, algorithm } = body;
        try {
          const { signatureB64, signer_kid, algorithm: alg } = signPayload({ digest_hex, canonical_payload, algorithm });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ signature: signatureB64, signer_kid, algorithm: alg }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
        }
        return;
      }

      if (url === '/verify') {
        const { digest_hex, canonical_payload, signature_b64, signature, algorithm } = body;
        const sig = signature_b64 || signature;
        if (!sig) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'signature_b64 or signature required' }));
          return;
        }
        const verified = verifySignature({ digest_hex, canonical_payload, signature_b64: sig, algorithm });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ verified }));
        return;
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
      return;
    }
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[signerMock] listening on 0.0.0.0:${PORT}`);
  console.log(`[signerMock] public key (PEM):\n${publicKey}`);
});

// Export public key to stdout file if env var set (useful for tests)
if (process.env.SIGNER_PUBLIC_KEY_OUT) {
  try {
    require('fs').writeFileSync(process.env.SIGNER_PUBLIC_KEY_OUT, publicKey, 'utf8');
    console.log(`[signerMock] exported public key to ${process.env.SIGNER_PUBLIC_KEY_OUT}`);
  } catch (e) {
    console.warn('[signerMock] failed to write public key out:', e && e.message ? e.message : e);
  }
}

