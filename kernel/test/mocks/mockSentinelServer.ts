// kernel/test/mocks/mockSentinelServer.ts
import http from 'http';
import { AddressInfo } from 'net';

export type MockSentinelOptions = {
  // If provided, this function receives the incoming payload and should return a PolicyDecision-like object.
  // By default we return { allowed: true, policyId: 'mock-allow', reason: 'default-allow' }
  onEvaluate?: (payload: any) => any;
  // If set, the server will respond with this HTTP status code (default 200)
  statusCode?: number;
  // Optional artificial delay in ms before responding (useful for timeout tests)
  delayMs?: number;
};

export async function startMockSentinelServer(opts: MockSentinelOptions = {}) {
  const { onEvaluate, statusCode = 200, delayMs = 0 } = opts;

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
          parsed = {};
        }

        if (req.url === '/evaluate') {
          const decision =
            typeof onEvaluate === 'function'
              ? await Promise.resolve(onEvaluate(parsed))
              : {
                  allowed: true,
                  policyId: 'mock-allow',
                  reason: 'default-allow',
                  rationale: {},
                  ts: new Date().toISOString(),
                };

          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }

          // If statusCode is not 200, return the decision body but with that status code.
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(decision));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message ?? String(err) }));
      }
    })();

    // Explicitly return so the outer callback has a clear void return path.
    return;
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

