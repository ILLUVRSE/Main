// kernel/test/mocks/mockKmsServer.ts
import http from 'http';
import { AddressInfo } from 'net';
import crypto from 'crypto';

export type MockKmsHandlers = {
  onSign?: (body: any) => any;
  onSignData?: (body: any) => any;
  onGetPublicKey?: (signerId: string) => any;
  publicKey?: string; // optional override (base64 or PEM)
  statusCode?: number; // default 200
};

export async function startMockKmsServer(opts: MockKmsHandlers = {}) {
  const { onSign, onSignData, onGetPublicKey, publicKey: overridePublicKey, statusCode = 200 } = opts;

  // If no override public key provided, generate an Ed25519 keypair and export the public key as base64 DER (SPKI).
  let generatedPublicKeyBase64: string | null = null;
  try {
    if (!overridePublicKey) {
      const { publicKey } = crypto.generateKeyPairSync('ed25519');
      const exported = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
      generatedPublicKeyBase64 = exported.toString('base64');
    }
  } catch (e) {
    // If key generation fails for any reason, we'll simply leave generatedPublicKeyBase64 null
    generatedPublicKeyBase64 = null;
  }

  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
    void (async () => {
      try {
        if (!req.url) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
          return;
        }

        // Basic routing
        //  - POST /sign
        //  - POST /signData
        //  - GET  /publicKeys/:signerId
        if (req.method === 'GET' && req.url.startsWith('/publicKeys/')) {
          // Extract signerId
          const parts = req.url.split('/');
          const signerId = decodeURIComponent(parts.slice(2).join('/')) || 'mock-signer';

          // Allow handler override
          if (typeof onGetPublicKey === 'function') {
            const maybe = await Promise.resolve(onGetPublicKey(signerId));
            // Handler may return a string or an object. If string, return as raw string response.
            if (typeof maybe === 'string') {
              res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
              res.end(maybe);
            } else {
              res.writeHead(statusCode, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(maybe));
            }
            return;
          }

          // Default: return configured overridePublicKey, else generatedPublicKeyBase64
          const pk = overridePublicKey ?? generatedPublicKeyBase64;
          if (!pk) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'no public key available in mock server' }));
            return;
          }
          // Return JSON { publicKey: "<base64 or PEM>" }
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ publicKey: pk }));
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
          return;
        }

        // Read body
        const bodyChunks: Buffer[] = [];
        for await (const chunk of req as any) {
          bodyChunks.push(chunk as Buffer);
        }
        const raw = Buffer.concat(bodyChunks).toString('utf8');
        let parsed: any = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (e) {
          parsed = {};
        }

        if (req.url === '/sign') {
          const manifestId = parsed.manifestId ?? parsed.manifest_id ?? `manifest-${Math.random().toString(36).slice(2, 8)}`;
          const resp =
            typeof onSign === 'function'
              ? await Promise.resolve(onSign(parsed))
              : {
                  id: `sig-${Math.random().toString(36).slice(2, 8)}`,
                  manifest_id: parsed.manifestId ?? parsed.manifest_id ?? manifestId,
                  signer_id: 'mock-signer',
                  signature: Buffer.from('mock-signature').toString('base64'),
                  version: '1.0.0',
                  ts: new Date().toISOString(),
                  prev_hash: null,
                };

          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resp));
          return;
        }

        if (req.url === '/signData') {
          const resp =
            typeof onSignData === 'function'
              ? await Promise.resolve(onSignData(parsed))
              : {
                  signature: Buffer.from('mock-signature-data').toString('base64'),
                  signerId: 'mock-signer',
                };

          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resp));
          return;
        }

        // Unknown path
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message ?? String(err) }));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    port: addr.port,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    // expose generated public key for tests if needed
    getDefaultPublicKeyBase64: () => generatedPublicKeyBase64,
  };
}

