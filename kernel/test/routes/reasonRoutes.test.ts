// kernel/test/routes/reasonRoutes.test.ts
import request from 'supertest';
import { createApp } from '../../src/server';
import { setReasoningClient, ReasoningClient } from '../../src/reasoning/client';
import * as auditStore from '../../src/auditStore';

class StubReasoningClient extends ReasoningClient {
  constructor() {
    super('http://reasoning.local');
  }

  async fetchTrace(nodeId: string) {
    return {
      node: nodeId,
      trace: [
        {
          step: 1,
          ts: new Date().toISOString(),
          note: 'User email alice@example.com should be hidden',
          data: { contact: '555-123-4567', ssn: '123-45-6789' },
        },
      ],
    };
  }
}

describe('GET /kernel/reason/:node', () => {
  beforeEach(() => {
    setReasoningClient(new StubReasoningClient());
    jest.spyOn(auditStore, 'appendAuditEvent').mockResolvedValue({
      id: 'audit-1',
      hash: 'hash',
      ts: new Date().toISOString(),
    } as any);
  });

  afterEach(() => {
    setReasoningClient(null);
    jest.restoreAllMocks();
  });

  test('returns redacted trace and records audit event', async () => {
    const app = await createApp();
    const res = await request(app).get('/kernel/reason/node-123');

    expect(res.status).toBe(200);
    expect(res.body.node).toBe('node-123');
    expect(res.body.trace[0].note).toContain('[REDACTED EMAIL]');
    expect(res.body.trace[0].data.contact).toBe('[REDACTED PHONE]');
    expect(res.body.trace[0].data.ssn).toBe('[REDACTED SSN]');

    const auditCalls = (auditStore.appendAuditEvent as jest.Mock).mock.calls;
    expect(auditCalls[0][0]).toBe('reason.trace.fetch');
    expect(auditCalls[0][1]).toMatchObject({ node: 'node-123' });
  });
});

