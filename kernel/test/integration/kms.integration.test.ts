// kernel/test/integration/kms.integration.test.ts
import http from 'http';
import fetchNode from 'node-fetch';

describe('KMS reachability (checkKmsReachable)', () => {
  beforeEach(() => {
    // Ensure a fresh module cache so server module reads process.env.KMS_ENDPOINT afresh
    jest.resetModules();

    // Polyfill global fetch if missing (some Jest runtimes don't expose global fetch)
    // Use node-fetch as a lightweight fallback.
    if (!(globalThis as any).fetch) {
      // @ts-ignore
      globalThis.fetch = fetchNode;
    }
  });

  test('returns true for reachable HTTP endpoint', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as any;
    const port = addr.port;

    try {
      // point KMS_ENDPOINT at the ephemeral server
      process.env.KMS_ENDPOINT = `http://127.0.0.1:${port}/`;
      // re-import server module after setting env so KMS_ENDPOINT constant is initialized correctly
      const mod: any = await import('../../src/server');
      const ok = await mod.checkKmsReachable(2000);
      expect(ok).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  test('returns false for unreachable endpoint', async () => {
    jest.resetModules();
    if (!(globalThis as any).fetch) {
      // @ts-ignore
      globalThis.fetch = fetchNode;
    }
    // pick a likely-unused port
    process.env.KMS_ENDPOINT = 'http://127.0.0.1:59999/';
    const mod: any = await import('../../src/server');
    const ok = await mod.checkKmsReachable(500);
    expect(ok).toBe(false);
  });
});

