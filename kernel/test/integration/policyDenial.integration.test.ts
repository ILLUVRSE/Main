import express from 'express';
import request from 'supertest';
import createKernelRouter from '../../src/routes/kernelRoutes';
import * as dbModule from '../../src/db';
import { MockDb } from '../utils/mockDb';
import { setSentinelClient, resetSentinelClient } from '../../src/sentinel/sentinelClient';
import { appendAuditEvent } from '../../src/auditStore';

jest.mock('../../src/auditStore', () => ({
  appendAuditEvent: jest.fn().mockResolvedValue({ id: 'audit-1', hash: 'hash-1', ts: new Date().toISOString() }),
  getAuditEventById: jest.fn(),
}));

describe('Sentinel policy auditing', () => {
  let db: MockDb;
  let app: express.Express;

  beforeEach(() => {
    db = new MockDb();
    jest.spyOn(dbModule, 'getClient').mockImplementation(async () => db.createClient());
    app = express();
    app.use(express.json());
    app.use(createKernelRouter());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetSentinelClient();
    (appendAuditEvent as jest.Mock).mockClear();
  });

  test('allocation denial returns 403 and records audit payload', async () => {
    const sentinel = {
      record: jest.fn(),
      enforcePolicy: jest.fn().mockResolvedValue({
        allowed: false,
        decisionId: 'deny-alloc-1',
        ruleId: 'rule-budget-cap',
        rationale: 'allocation exceeds budget',
        reason: 'allocation exceeds budget',
      }),
    };

    setSentinelClient(sentinel);

    const response = await request(app)
      .post('/kernel/allocate')
      .set('x-user-id', 'operator-1')
      .set('x-roles', 'Operator')
      .set('Idempotency-Key', 'alloc-test-1')
      .send({ entity_id: 'division-1', delta: 50 });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: 'policy.denied', reason: 'allocation exceeds budget' });
    expect(sentinel.enforcePolicy).toHaveBeenCalledTimes(1);

    const auditCalls = (appendAuditEvent as jest.Mock).mock.calls.filter(([eventType]) => eventType === 'policy.decision');
    expect(auditCalls).toHaveLength(1);

    const [, payload] = auditCalls[0];
    expect(payload).toMatchObject({
      policy: 'allocation.request',
      principal: { id: 'operator-1', type: 'human', roles: ['Operator'] },
      decision: {
        id: 'deny-alloc-1',
        ruleId: 'rule-budget-cap',
        rationale: 'allocation exceeds budget',
        allowed: false,
      },
    });
    expect(payload.decision.timestamp).toEqual(expect.any(String));
    expect(payload.context).toMatchObject({
      allocation: { entityId: 'division-1', delta: 50, pool: null },
    });
  });
});
