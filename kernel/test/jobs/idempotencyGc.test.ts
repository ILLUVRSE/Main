import { runIdempotencyGcJob } from '../../src/jobs/idempotencyGc';
import * as dbModule from '../../src/db';

const DELETE_RESULT = { rows: [], rowCount: 0, command: 'DELETE', oid: 0, fields: [] };

describe('runIdempotencyGcJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.IDEMPOTENCY_TTL_SECONDS;
  });

  test('deletes expired entries using ttl from env', async () => {
    process.env.IDEMPOTENCY_TTL_SECONDS = '120';
    const now = new Date('2024-02-01T00:00:00.000Z');
    const queryMock = jest
      .spyOn(dbModule, 'query')
      .mockResolvedValue({ ...DELETE_RESULT, rowCount: 5 });

    const result = await runIdempotencyGcJob(now);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql.toLowerCase()).toContain('delete from idempotency');
    expect(Array.isArray(params)).toBe(true);
    expect(params?.[0]).toBe(new Date(now.getTime() - 120 * 1000).toISOString());
    expect(result.deleted).toBe(5);
    expect(result.thresholdIso).toBe(params?.[0]);
  });

  test('falls back to default ttl when env invalid', async () => {
    process.env.IDEMPOTENCY_TTL_SECONDS = '-10';
    const now = new Date('2024-02-01T00:00:00.000Z');
    const queryMock = jest.spyOn(dbModule, 'query').mockResolvedValue({ ...DELETE_RESULT });

    await runIdempotencyGcJob(now);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0];
    expect(call).toBeDefined();
    const params = (call?.[1] as string[] | undefined) ?? [];
    expect(params.length).toBeGreaterThan(0);
    const thresholdIso = params[0];
    const expected = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(thresholdIso).toBe(expected);
  });
});
