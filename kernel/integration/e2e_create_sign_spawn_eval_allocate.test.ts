// kernel/integration/e2e_create_sign_spawn_eval_allocate.test.ts
jest.mock('../src/middleware/idempotency', () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
}));

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/server';
import * as db from '../src/db';
import * as signingProxy from '../src/signingProxy';
import * as auditStore from '../src/auditStore';

type DbRow = Record<string, any>;

describe('E2E create → sign → spawn → eval → allocate', () => {
  const divisions = new Map<string, DbRow>();
  const manifestSignatures = new Map<string, DbRow>();
  const agents = new Map<string, DbRow>();
  const evalReports: DbRow[] = [];
  const allocations: DbRow[] = [];
  const auditEvents: { type: string; payload: any }[] = [];

  const parseMaybeJson = (value: any) => {
    if (value == null) return value;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  const handleQuery = async (sql: string, params: any[] = []) => {
    const normalized = sql.trim().toLowerCase();

    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
      return { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith('select hash from audit_events')) {
      return { rows: [] };
    }

    if (normalized.startsWith('insert into manifest_signatures')) {
      const row: DbRow = {
        id: params[0],
        manifest_id: params[1],
        signer_id: params[2],
        signature: params[3],
        version: params[4],
        ts: params[5],
        prev_hash: params[6],
      };
      manifestSignatures.set(String(row.id), row);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('insert into divisions')) {
      const row: DbRow = {
        id: params[0],
        name: params[1],
        goals: parseMaybeJson(params[2]) ?? [],
        budget: params[3],
        currency: params[4],
        kpis: parseMaybeJson(params[5]) ?? [],
        policies: parseMaybeJson(params[6]) ?? [],
        metadata: parseMaybeJson(params[7]) ?? {},
        status: params[8],
        version: params[9],
        manifest_signature_id: params[10],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      divisions.set(String(row.id), row);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('select id, name, goals')) {
      const row = divisions.get(String(params[0]));
      return { rows: row ? [row] : [] };
    }

    if (normalized.startsWith('insert into agents')) {
      const row: DbRow = {
        id: params[0],
        template_id: params[1],
        role: params[2],
        skills: parseMaybeJson(params[3]) ?? [],
        code_ref: params[4],
        division_id: params[5],
        state: params[6],
        score: params[7],
        resource_allocation: parseMaybeJson(params[8]) ?? {},
        last_heartbeat: new Date().toISOString(),
        owner: params[9],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      agents.set(String(row.id), row);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('select * from agents where id =')) {
      const row = agents.get(String(params[0]));
      return { rows: row ? [row] : [] };
    }

    if (normalized.startsWith('insert into eval_reports')) {
      const row: DbRow = {
        id: params[0],
        agent_id: params[1],
        metric_set: parseMaybeJson(params[2]) ?? {},
        timestamp: params[3],
        source: params[4],
        computed_score: params[5],
        window: params[6],
      };
      evalReports.push(row);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('update agents set score')) {
      const agent = agents.get(String(params[1]));
      if (agent) {
        agent.score = params[0];
        agent.updated_at = new Date().toISOString();
      }
      return { rows: [], rowCount: agent ? 1 : 0 };
    }

    if (normalized.startsWith('select * from eval_reports where agent_id')) {
      const rows = evalReports
        .filter((row) => String(row.agent_id) === String(params[0]))
        .sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
      return { rows };
    }

    if (normalized.startsWith('insert into resource_allocations')) {
      const row: DbRow = {
        id: params[0],
        entity_id: params[1],
        pool: params[2],
        delta: params[3],
        reason: params[4],
        requested_by: params[5],
        status: params[6],
        ts: new Date().toISOString(),
      };
      allocations.push(row);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled query in test harness: ${sql}`);
  };

  const createClient = () => ({
    query: (sql: string, params?: any[]) => handleQuery(sql, params),
    release: () => {},
  });

  beforeEach(() => {
    divisions.clear();
    manifestSignatures.clear();
    agents.clear();
    evalReports.length = 0;
    allocations.length = 0;
    auditEvents.length = 0;

    jest.spyOn(db, 'getClient').mockImplementation(async () => createClient() as any);
    jest.spyOn(db, 'query').mockImplementation((sql: string, params?: any[]) => handleQuery(sql, params));

    jest.spyOn(signingProxy, 'signManifest').mockResolvedValue({
      id: 'sig-' + crypto.randomUUID(),
      signerId: 'test-signer',
      signature: 'signed',
      version: '1.0.0',
      ts: new Date().toISOString(),
    } as any);
    jest.spyOn(signingProxy, 'signData').mockResolvedValue({ signature: 'audit-signature', signerId: 'test-signer' });

    jest.spyOn(auditStore, 'appendAuditEvent').mockImplementation(async (type: string, payload: any) => {
      auditEvents.push({ type, payload });
      return { id: crypto.randomUUID(), hash: 'hash', ts: new Date().toISOString() } as any;
    });

    jest.spyOn(require('../src/sentinel/sentinelClient'), 'enforcePolicyOrThrow').mockImplementation(async () => ({
      allowed: true,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('happy path through division, agent, eval, allocation', async () => {
    const app = await createApp();

    const manifest = {
      id: 'division-1',
      name: 'Exploration',
      goals: ['expand frontier'],
      budget: 1000000,
      currency: 'USD',
    };

    const divisionRes = await request(app).post('/kernel/division').send(manifest);
    expect(divisionRes.status).toBe(200);

    const fetchDivision = await request(app).get('/kernel/division/division-1');
    expect(fetchDivision.status).toBe(200);
    expect(fetchDivision.body).toMatchObject({ id: 'division-1', name: 'Exploration' });

    const agentRes = await request(app)
      .post('/kernel/agent')
      .set('Idempotency-Key', 'agent-ik')
      .send({ divisionId: 'division-1', role: 'scout', templateId: 'template-1' });
    expect(agentRes.status).toBe(201);
    const agentId = agentRes.body.id;

    const evalRes = await request(app)
      .post('/kernel/eval')
      .set('Idempotency-Key', 'eval-ik')
      .send({ agent_id: agentId, metric_set: { accuracy: 0.9 }, computedScore: 0.9 });
    expect(evalRes.status).toBe(200);

    const agentState = await request(app).get(`/kernel/agent/${agentId}/state`);
    expect(agentState.status).toBe(200);
    expect(agentState.body.agent).toMatchObject({ id: agentId, divisionId: 'division-1' });
    expect(agentState.body.evals).toHaveLength(1);

    const allocRes = await request(app)
      .post('/kernel/allocate')
      .set('Idempotency-Key', 'alloc-ik')
      .send({ entity_id: agentId, pool: 'compute', delta: 5 });
    expect(allocRes.status).toBe(200);

    expect(divisions.has('division-1')).toBe(true);
    expect(manifestSignatures.size).toBeGreaterThan(0);
    expect(agents.has(agentId)).toBe(true);
    expect(evalReports.some((row) => row.agent_id === agentId)).toBe(true);
    expect(allocations.some((row) => row.entity_id === agentId)).toBe(true);

    const eventTypes = auditEvents.map((e) => e.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining(['manifest.update', 'agent.spawn', 'eval.submitted', 'allocation.request']),
    );
  });
});

