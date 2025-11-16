/**
 * memory-layer/service/audit/signerProxyMockServer.ts
 *
 * Simple mock signing proxy (Express) for local development and CI.
 * Provides:
 *  - POST /sign/canonical  { canonical } -> { kid, alg, signature }
 *  - POST /sign/hash       { digest_hex } -> { kid, alg, signature }
 *  - POST /verify          { digest_hex, signature } -> { valid: boolean }
 *
 * Authentication:
 *  - If SIGNING_PROXY_API_KEY is set, requests must include Authorization: Bearer <key>.
 *
 * Usage (dev):
 *   SIGNING_PROXY_API_KEY=localkey npx ts-node memory-layer/service/audit/signerProxyMockServer.ts
 *
 * Note: This server is for tests/dev only. Do not use in production.
 */

import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import mockSigner from './mockSigner';

const PORT = Number(process.env.SIGNING_PROXY_PORT ?? 8081);
const API_KEY = process.env.SIGNING_PROXY_API_KEY ?? undefined;

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

function requireAuth(req: Request, res: Response): boolean {
  if (!API_KEY) return true;
  const auth = req.header('authorization') || req.header('Authorization');
  if (!auth) {
    res.status(401).json({ error: 'missing Authorization header' });
    return false;
  }
  const parts = String(auth).split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || parts[1] !== API_KEY) {
    res.status(403).json({ error: 'invalid API key' });
    return false;
  }
  return true;
}

app.post('/sign/canonical', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const canonical = req.body?.canonical;
  if (!canonical || typeof canonical !== 'string') {
    res.status(400).json({ error: 'canonical (string) required' });
    return;
  }
  try {
    const resp = await mockSigner.signAuditCanonical(canonical);
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || String(err) });
  }
});

app.post('/sign/hash', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const digestHex = req.body?.digest_hex || req.body?.digestHex;
  if (!digestHex || typeof digestHex !== 'string' || !/^[0-9a-fA-F]+$/.test(digestHex)) {
    res.status(400).json({ error: 'digest_hex (hex string) required' });
    return;
  }
  try {
    const digestBuf = Buffer.from(digestHex, 'hex');
    const resp = await mockSigner.signAuditHash(digestBuf);
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || String(err) });
  }
});

app.post('/verify', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const digestHex = req.body?.digest_hex || req.body?.digestHex;
  const signature = req.body?.signature;
  if (!digestHex || typeof digestHex !== 'string' || !/^[0-9a-fA-F]+$/.test(digestHex)) {
    res.status(400).json({ error: 'digest_hex (hex string) required' });
    return;
  }
  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ error: 'signature (base64 string) required' });
    return;
  }
  try {
    const digestBuf = Buffer.from(digestHex, 'hex');
    const ok = await mockSigner.verifySignature(signature, digestBuf);
    res.json({ valid: Boolean(ok) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || String(err) });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', now: new Date().toISOString() });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.info(`Signer proxy mock server listening on http://localhost:${PORT}`);
    if (API_KEY) {
      console.info('Authentication: API key required (SIGNING_PROXY_API_KEY set)');
    } else {
      console.info('Authentication: none (SIGNING_PROXY_API_KEY not set)');
    }
  });
}

export default app;

