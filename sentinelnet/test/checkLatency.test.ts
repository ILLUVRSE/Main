import policyStore from '../src/services/policyStore';
import { processCheckRequest } from '../src/routes/check';

describe('sentinel check latency harness', () => {
  test('local p95 stays below 200ms', async () => {
    const spy = jest.spyOn(policyStore, 'listPolicies').mockResolvedValue([]);
    try {
      const durations: number[] = [];
      const iterations = 30;

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        const res = await processCheckRequest({ action: `noop-${i}` });
        expect(res.status).toBe(200);
        const end = process.hrtime.bigint();
        const millis = Number(end - start) / 1_000_000;
        durations.push(millis);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.floor(0.95 * durations.length) - 1;
      const p95 = durations[Math.max(0, p95Index)];
      expect(p95).toBeLessThan(200);
    } finally {
      spy.mockRestore();
    }
  });
});
