import express from 'express';
import request from '../utils/mockSupertest';
import createUpgradeRouter from '../../src/routes/upgradeRoutes';
import * as dbModule from '../../src/db';
import * as auditStore from '../../src/auditStore';
import { MockDb } from '../utils/mockDb';

const APPROVERS = ['approver-a', 'approver-b', 'approver-c', 'approver-d', 'approver-e'];

describe('upgradeRoutes', () => {
  let db: MockDb;
  let auditSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.UPGRADE_APPROVER_IDS = APPROVERS.join(',');
    process.env.UPGRADE_REQUIRED_APPROVALS = '3';

    db = new MockDb();
    jest.spyOn(dbModule, 'query').mockImplementation(async (text: string, params?: any[]) => {
      return db.handleQuery(text, params ?? []);
    });

    auditSpy = jest
      .spyOn(auditStore, 'appendAuditEvent')
      .mockResolvedValue({ id: 'audit', hash: 'hash', ts: new Date().toISOString() });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.UPGRADE_APPROVER_IDS;
    delete process.env.UPGRADE_REQUIRED_APPROVALS;
  });

  test('requires 3-of-5 approvals before apply', async () => {
    const app = express();
    app.use(express.json());
    app.use('/kernel/upgrade', createUpgradeRouter());

    const manifest = {
      upgradeId: 'upgrade-123',
      type: 'code',
      target: 'repo@abc123',
      rationale: 'test upgrade',
      timestamp: new Date().toISOString(),
      proposedBy: 'requestor-1',
    };

    const submitRes = await request(app)
      .post('/kernel/upgrade')
      .send({ manifest, submittedBy: 'requestor-1' });

    expect(submitRes.status).toBe(201);
    expect(submitRes.body.upgrade.status).toBe('pending');

    const approve = async (approverId: string) => {
      const res = await request(app)
        .post(`/kernel/upgrade/${manifest.upgradeId}/approve`)
        .send({ approverId, signature: `sig-${approverId}` });
      expect(res.status).toBe(201);
      return res;
    };

    await approve(APPROVERS[0]);
    await approve(APPROVERS[1]);

    const earlyApply = await request(app)
      .post(`/kernel/upgrade/${manifest.upgradeId}/apply`)
      .send({ appliedBy: 'deployer-1' });
    expect(earlyApply.status).toBe(400);
    expect(earlyApply.body).toMatchObject({ error: 'insufficient_quorum', approvals: 2, required: 3 });

    await approve(APPROVERS[2]);

    const applyRes = await request(app)
      .post(`/kernel/upgrade/${manifest.upgradeId}/apply`)
      .send({ appliedBy: 'deployer-1' });

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.upgrade.status).toBe('applied');
    expect(applyRes.body.quorum).toMatchObject({ required: 3 });
    expect(applyRes.body.quorum.approvers).toHaveLength(3);
    expect(new Set(applyRes.body.quorum.approvers)).toEqual(
      new Set([APPROVERS[0], APPROVERS[1], APPROVERS[2]]),
    );

    const eventTypes = auditSpy.mock.calls.map((call) => call[0]);
    expect(eventTypes).toEqual([
      'upgrade.submitted',
      'upgrade.approval',
      'upgrade.approval',
      'upgrade.approval',
      'upgrade.applied',
    ]);
  });
});
