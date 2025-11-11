/**
 * kernel/test/mocks/mockKmsServer.ts
 *
 * Lightweight mock KMS/Signing HTTP server used by unit/integration tests.
 *
 * Endpoints:
 *  - GET  /health         -> 200 { ok: true }
 *  - POST /sign           -> expects { manifest } -> returns manifest signature object
 *  - POST /sign/data      -> expects { data }     -> returns { signature, signerId }
 *
 * This is not a crypto-accurate KMS; it returns deterministic "signatures"
 * (sha256 of the JSON payload encoded base64) so tests can verify shapes.
 *
 * Run with: node -r ts-node/register kernel/test/mocks/mockKmsServer.ts
 * Or compile and run the emitted JS.
 */

import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const PORT = Number(process.env.MOCK_KMS_PORT || 7601);
const HOST = process.env.MOCK_KMS_HOST || '127.0.0.1';
const SIGNER_ID = process.env.MOCK_KMS_SIGNER_ID || 'mock-kms-signer-v1';

function sha256Base64(input: string): string {
  const h = crypto.createHash('sha256').update(input).digest();
  return h.toString('base64');
}

function makeManifestSignature(manifest: any) {
  const id = `sig-${manifest?.id ?? uuidv4()}`;
  const manifestId = manifest?.id ?? null;
  // Deterministic signature: hash of a stable JSON representation
  const normalized = (() => {
    try {
      // stable stringify: sort keys
      const normalize = (obj: any): any => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(normalize);
        const out: Record<string, any> = {};
        for (const k of Object.keys(obj).sort()) out[k] = normalize(obj[k]);
        return out;
      };
      return JSON.stringify(normalize(manifest));
    } catch {
      return String(manifest);
    }
  })();
  const signature = sha256Base64(normalized);
  return {
    id,
    manifestId,
    signerId: SIGNER_ID,
    signature,
    version: manifest?.version ?? '1.0.0',
    ts: new Date().toISOString(),
    prevHash: null,
  };
}

function makeDataSignature(data: string) {
  const sig = sha256Base64(typeof data === 'string' ? data : JSON.stringify(data));
  return { signature: sig, signerId: SIGNER_ID };
}

function createApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, signerId: SIGNER_ID });
  });

  app.post('/sign', (req, res) => {
    try {
      const manifest = req.body?.manifest ?? req.body;
      if (!manifest) {
        return res.status(400).json({ error: 'missing manifest in body' });
      }
      const sig = makeManifestSignature(manifest);
      return res.json(sig);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('mock-kms /sign error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  app.post('/sign/data', (req, res) => {
    try {
      // Accept either { data } or { payload } or raw body
      const data = req.body?.data ?? req.body?.payload ?? req.body;
      if (data === undefined) {
        return res.status(400).json({ error: 'missing data in body' });
      }
      const out = makeDataSignature(data);
      return res.json(out);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('mock-kms /sign/data error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  // Simple ping for tests
  app.get('/', (_req, res) => {
    res.send('mock-kms ok');
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`mock-kms: listening on http://${HOST}:${PORT}`);
  });
}

export default createApp;

