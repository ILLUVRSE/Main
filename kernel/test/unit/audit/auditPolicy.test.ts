// kernel/test/unit/audit/auditPolicy.test.ts
import { evaluateAuditPolicy, setSamplingRandom, cleanupExpiredAuditEvents } from '../../../src/audit/auditPolicy';
import * as db from '../../../src/db';

describe('auditPolicy', () => {
  afterEach(() => {
    setSamplingRandom(() => 0.5);
    jest.restoreAllMocks();
  });

  test('critical events always kept', () => {
    const result = evaluateAuditPolicy('manifest.update', { roles: [] });
    expect(result.keep).toBe(true);
    expect(result.sampled).toBe(false);
  });

  test('sampling respects random function', () => {
    setSamplingRandom(() => 0.9);
    const result = evaluateAuditPolicy('agent.heartbeat', { roles: [] });
    expect(result.keep).toBe(false);
    expect(result.sampled).toBe(true);
  });

  test('role override forces keep', () => {
    setSamplingRandom(() => 0.0);
    const result = evaluateAuditPolicy('agent.heartbeat', { roles: ['SuperAdmin'] });
    expect(result.keep).toBe(true);
    expect(result.sampled).toBe(false);
  });

  test('cleanupExpiredAuditEvents issues delete query', async () => {
    const spy = jest.spyOn(db, 'query').mockResolvedValue({ rowCount: 3 } as any);
    const removed = await cleanupExpiredAuditEvents();
    expect(spy).toHaveBeenCalled();
    expect(removed).toBe(3);
  });
});

