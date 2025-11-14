import canary from '../src/services/canary';

const basePolicy: any = {
  id: 'policy-1',
  name: 'test-policy',
  version: 1,
  severity: 'LOW',
  rule: {},
  metadata: { canaryPercent: 25 },
  state: 'canary',
  createdBy: 'tester',
  createdAt: new Date().toISOString(),
};

describe('canary.shouldApplyCanary', () => {
  test('deterministic sampling for same request id', () => {
    const ctx = { requestId: 'abc-123' };
    const first = canary.shouldApplyCanary(basePolicy, ctx);
    const second = canary.shouldApplyCanary(basePolicy, ctx);
    const third = canary.shouldApplyCanary(basePolicy, { requestId: 'abc-123' });
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  test('boundaries: 0 percent never applies, 100 percent always applies', () => {
    const neverPolicy = { ...basePolicy, metadata: { canaryPercent: 0 } };
    const alwaysPolicy = { ...basePolicy, metadata: { canaryPercent: 100 } };
    expect(canary.shouldApplyCanary(neverPolicy, { requestId: 'req-1' })).toBe(false);
    expect(canary.shouldApplyCanary(alwaysPolicy, { requestId: 'req-1' })).toBe(true);
  });
});
