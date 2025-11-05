// kernel/test/sentinelClient.test.ts
import { startMockSentinelServer } from './mocks/mockSentinelServer';

afterEach(() => {
  jest.resetModules();
  delete process.env.SENTINEL_URL;
  delete process.env.SENTINEL_FALLBACK_ALLOW;
  delete process.env.SENTINEL_TIMEOUT_MS;
});

describe('sentinelClient', () => {
  test('evaluatePolicy fallback allow (no SENTINEL_URL)', async () => {
    // Default fallback allow is true
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { evaluatePolicy } = require('../src/sentinelClient');
    const decision = await evaluatePolicy('any.action', { foo: 'bar' });
    expect(decision).toBeDefined();
    expect(decision.allowed).toBe(true);
    expect(decision.policyId).toMatch(/fallback-allow/);
  });

  test('evaluatePolicy fallback deny when SENTINEL_FALLBACK_ALLOW=false', async () => {
    process.env.SENTINEL_FALLBACK_ALLOW = 'false';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { evaluatePolicy } = require('../src/sentinelClient');
    const decision = await evaluatePolicy('action', {});
    expect(decision).toBeDefined();
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toMatch(/fallback-deny/);
  });

  test('evaluatePolicy uses remote sentinel when SENTINEL_URL set', async () => {
    const server = await startMockSentinelServer({
      onEvaluate: (payload: any) => ({ allowed: false, policyId: 'p1', reason: 'blocked', ts: new Date().toISOString() }),
    });
    try {
      process.env.SENTINEL_URL = server.url;
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { evaluatePolicy } = require('../src/sentinelClient');
      const decision = await evaluatePolicy('action.remote', { a: 1 });
      expect(decision).toBeDefined();
      expect(decision.allowed).toBe(false);
      expect(decision.policyId).toBe('p1');
      expect(decision.reason).toBe('blocked');
    } finally {
      await server.close();
    }
  });

  test('enforcePolicyOrThrow throws PolicyDeniedError when remote denies', async () => {
    const server = await startMockSentinelServer({
      onEvaluate: () => ({ allowed: false, policyId: 'deny-1', reason: 'nope', ts: new Date().toISOString() }),
    });
    try {
      process.env.SENTINEL_URL = server.url;
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { enforcePolicyOrThrow, PolicyDeniedError } = require('../src/sentinelClient');

      await expect(enforcePolicyOrThrow('x', {})).rejects.toThrow(PolicyDeniedError);
    } finally {
      await server.close();
    }
  });

  test('network timeout to sentinel returns fallback decision', async () => {
    // Start server that delays longer than configured timeout
    const server = await startMockSentinelServer({ delayMs: 200 });
    try {
      process.env.SENTINEL_URL = server.url;
      // set small timeout so it triggers
      process.env.SENTINEL_TIMEOUT_MS = '50';
      // set fallback allow to false so we can assert fallback denies
      process.env.SENTINEL_FALLBACK_ALLOW = 'false';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { evaluatePolicy } = require('../src/sentinelClient');
      const decision = await evaluatePolicy('timed.out', {});
      expect(decision).toBeDefined();
      // network timeout should result in fallback decision with allowed === false
      expect(decision.allowed).toBe(false);
      expect(decision.policyId).toMatch(/sentinel-unreachable|fallback-deny/);
    } finally {
      await server.close();
    }
  });
});

