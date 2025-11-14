import type { Policy } from '../src/models/policy';

jest.mock('../src/services/canary', () => ({
  stopCanary: jest.fn().mockResolvedValue(undefined),
}));

describe('canaryRollback service', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      SENTINEL_CANARY_AUTO_ROLLBACK: 'true',
      SENTINEL_CANARY_ROLLBACK_WINDOW: '3',
      SENTINEL_CANARY_ROLLBACK_THRESHOLD: '0.5',
      SENTINEL_CANARY_ROLLBACK_COOLDOWN_MS: '0',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
  });

  function buildPolicy(overrides?: Partial<Policy>): Policy {
    return {
      id: 'policy-1',
      name: 'test',
      version: 1,
      severity: 'MEDIUM',
      rule: {},
      state: 'canary',
      metadata: { canaryPercent: 10 },
      createdBy: null,
      createdAt: new Date().toISOString(),
      ...(overrides || {}),
    } as Policy;
  }

  it('triggers rollback when failure rate exceeds threshold', async () => {
    // late import after env + mocks
    const canaryRollback = await import('../src/services/canaryRollback');
    const policy = buildPolicy();
    const record = canaryRollback.recordDecision;
    await record(policy, { enforced: true, allowed: false, effect: 'deny' });
    await record(policy, { enforced: true, allowed: true, effect: 'allow' });
    await record(policy, { enforced: true, allowed: false, effect: 'deny' });

    const canaryService = require('../src/services/canary');
    expect(canaryService.stopCanary).toHaveBeenCalledTimes(1);
  });
});
