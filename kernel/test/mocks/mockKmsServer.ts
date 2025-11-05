// kernel/test/mocks/mockKmsServer.ts
import http from 'http';
import { AddressInfo } from 'net';

export type MockKmsHandlers = {
  onSign?: (body: any) => any;
  onSignData?: (body: any) => any;
  statusCode?: number; // default 200
};

export async function startMockKmsServer(opts: MockKmsHandlers = {}) {
  const { onSign, onSignData, statusCode = 200 } = opts;

  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
    // Use an async IIFE and prefix with `void` so the outer callback returns void (no TS7030).
    void (async () => {
      try {
        if (!req.url || req.method !== 'POST') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
          return;
        }

        const bodyChunks: Buffer[] = [];
        for await (const chunk of req as any) {
          bodyChunks.push(chunk as Buffer);
        }
        const raw = Buffer.concat(bodyChunks).toString('utf8');
        let parsed: any = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (e) {
          // ignore JSON parse errors
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
  };
}

