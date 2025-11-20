#!/usr/bin/env node
/**
 * kernel/mock/signingProxyMock.js
 *
 * Lightweight signing-proxy emulator for local development.
 * - POST /sign { hash } → { signature, signer_kid, ts }
 * - POST /health → { ok: true }
 *
 * Uses an HMAC-based signature derived from DEV_SIGNING_SECRET.
 */
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.SIGNING_PROXY_PORT || process.env.PORT || 9100);
const HOST = process.env.SIGNING_PROXY_HOST || '0.0.0.0';
const SIGNER_KID = process.env.SIGNING_PROXY_KID || 'dev-signer-v1';
const SECRET = process.env.DEV_SIGNING_SECRET || 'illuvrse-dev-signing-secret';

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { error: 'not_found' });
}

function methodNotAllowed(res) {
  json(res, 405, { error: 'method_not_allowed' });
}

function handleSign(req, res, body) {
  let parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch (err) {
    return json(res, 400, { error: 'invalid_json', details: err.message });
  }
  const hash = parsed.hash;
  if (!hash || typeof hash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hash)) {
    return json(res, 400, { error: 'invalid_hash', message: 'hash must be 64 hex chars' });
  }

  const signature = crypto.createHmac('sha256', SECRET).update(hash).digest('base64');
  return json(res, 200, {
    signature,
    signer_kid: SIGNER_KID,
    ts: new Date().toISOString()
  });
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 10 * 1024) {
      res.destroy();
    }
  });

  req.on('end', () => {
    if (req.url === '/sign' && req.method === 'POST') {
      return handleSign(req, res, body);
    }
    if (req.url === '/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, signer_kid: SIGNER_KID });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      return methodNotAllowed(res);
    }
    return notFound(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[signing-proxy-mock] listening on http://${HOST}:${PORT} signer=${SIGNER_KID}`);
});
