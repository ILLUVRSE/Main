import http from 'http';
import crypto from 'crypto';
import { SigningProxy } from '../src/services/signingProxy';

const LOCAL_PREFIX = 'local-ed25519:';

type MockServer = {
  url: string;
  close: () => Promise<void>;
};

function startKmsServer(opts: {
  signerId?: string;
  signKey: crypto.KeyObject;
  verifyKey: crypto.KeyObject;
  status?: number;
}): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const { signerId = 'kms-signer', signKey, verifyKey, status } = opts;
    const server = http.createServer(async (req, res) => {
      const body = await readBody(req);
      if (req.method === 'POST' && req.url === '/sign') {
        if (status && status >= 400) {
          res.writeHead(status).end('boom');
          return;
        }
        const payload = Buffer.from(body.payload_b64, 'base64');
        const sig = crypto.sign(null, payload, signKey);
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            signature_b64: sig.toString('base64'),
            signer_id: signerId,
          }),
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/verify') {
        const payload = Buffer.from(body.payload_b64, 'base64');
        const sig = Buffer.from(body.signature_b64, 'base64');
        const verified = crypto.verify(null, payload, verifyKey, sig);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ verified }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({
          url: `http://127.0.0.1:${addr.port}`,
          close: () =>
            new Promise<void>((done) => {
              server.close(() => done());
            }),
        });
      } else {
        reject(new Error('failed to start server'));
      }
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function exportRawPrivateKeyBase64(key: crypto.KeyObject): { privB64: string; pub: Buffer } {
  const jwk = key.export({ format: 'jwk' }) as any;
  const privRaw = Buffer.from(jwk.d, 'base64url');
  const pubRaw = Buffer.from(jwk.x, 'base64url');
  return { privB64: privRaw.toString('base64'), pub: pubRaw };
}

describe('SigningProxy', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('uses KMS endpoint when available', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const server = await startKmsServer({ signKey: privateKey, verifyKey: publicKey });
    process.env.SENTINEL_KMS_ENDPOINT = server.url;
    delete process.env.SENTINEL_SIGNER_KEY_B64;

    try {
      const proxy = new SigningProxy();
      const payload = Buffer.from('kms-payload');
      const { signatureB64, signerId } = await proxy.sign(payload);
      expect(signerId).toBe('kms-signer');
      await proxy.verify(payload, signatureB64, signerId);
    } finally {
      await server.close();
    }
  });

  test('falls back to local Ed25519 when KMS fails', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const { privB64 } = exportRawPrivateKeyBase64(privateKey);
    const server = await startKmsServer({
      signKey: privateKey,
      verifyKey: publicKey,
      status: 500,
    });
    process.env.SENTINEL_KMS_ENDPOINT = server.url;
    process.env.SENTINEL_SIGNER_KEY_B64 = privB64;

    try {
      const proxy = new SigningProxy();
      const payload = Buffer.from('fallback');
      const { signatureB64, signerId } = await proxy.sign(payload);
      expect(signerId.startsWith(LOCAL_PREFIX)).toBeTruthy();
      await proxy.verify(payload, signatureB64, signerId);
    } finally {
      await server.close();
    }
  });

  test('signs locally when no KMS endpoint configured', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const { privB64 } = exportRawPrivateKeyBase64(privateKey);
    process.env.SENTINEL_KMS_ENDPOINT = '';
    process.env.SENTINEL_SIGNER_KEY_B64 = privB64;
    const proxy = new SigningProxy();
    const payload = Buffer.from('local-only');
    const { signatureB64, signerId } = await proxy.sign(payload);
    expect(signerId.startsWith(LOCAL_PREFIX)).toBeTruthy();
    await proxy.verify(payload, signatureB64, signerId);
  });
});
