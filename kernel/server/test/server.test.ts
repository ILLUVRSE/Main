import request from 'supertest';
import { newDb } from 'pg-mem';
import { KernelDb } from '../src/db';
import { createApp } from '../src/index';

describe('kernel runtime server', () => {
  let db: KernelDb;
  let app: any;

  beforeEach(async () => {
    process.env.DEV_SKIP_MTLS = 'true';
    const mem = newDb({ autoCreateForeignKeyIndices: true });
    const { Pool } = mem.adapters.createPg();
    const pool = new Pool();
    db = new KernelDb({ pool });
    await db.migrate();
    app = await createApp(db);
  });

  afterEach(async () => {
    await db.end();
  });

  test('health and readiness', async () => {
    const health = await request(app).get('/health').expect(200);
    expect(health.body.status).toBe('ok');

    const ready = await request(app).get('/ready').expect(200);
    expect(ready.body.status).toBe('ready');
  });

  test('sign manifest and retrieve audit', async () => {
    const res = await request(app)
      .post('/kernel/sign')
      .send({ manifest: { id: 'manifest-1', name: 'test' }, signerId: 'tester' })
      .expect(200);
    expect(res.body.manifestSignatureId).toBeDefined();

    const auditRow = await db
      .getPool()
      .query('SELECT id FROM audit_events ORDER BY ts DESC LIMIT 1');
    const auditId = auditRow.rows[0].id;
    const auditRes = await request(app).get(`/kernel/audit/${auditId}`).expect(200);
    expect(auditRes.body.hash).toBeDefined();
    expect(auditRes.body.payload.manifestId).toBe('manifest-1');
  });

  test('create agent, eval, and state fetch', async () => {
    const agent = await request(app)
      .post('/kernel/agent')
      .send({ templateId: 'tmpl-1', divisionId: 'div-1', overrides: {} })
      .expect(202);
    const agentId = agent.body.agentId;
    expect(agentId).toBeDefined();

    await request(app)
      .post('/kernel/eval')
      .send({ agentId, metricSet: { acc: 1 } })
      .expect(200);

    const state = await request(app).get(`/kernel/agent/${agentId}/state`).expect(200);
    expect(state.body.agent.id).toBe(agentId);
    expect(Array.isArray(state.body.evals)).toBe(true);
    expect(state.body.evals.length).toBe(1);
  });

  test('allocation flow', async () => {
    const res = await request(app)
      .post('/kernel/allocate')
      .send({ divisionId: 'div-2', cpu: 2 })
      .expect(200);
    expect(res.body.allocation_id).toBeDefined();
  });
});
