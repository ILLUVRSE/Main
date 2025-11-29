
import { newDb } from 'pg-mem';
import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { setPool, insertMemoryNodeWithAudit } from '../../service/db';
import { MemoryNodeInput } from '../../service/types';

const migrationsDir = path.join(__dirname, '../../sql/migrations');

const getMigrations = () => {
  return fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => path.join(migrationsDir, f));
};

const sanitizeSql = (sql: string) =>
  sql
    .replace(/CREATE EXTENSION IF NOT EXISTS [^;]+;/gi, '')
    .replace(/BEGIN;/gi, '')
    .replace(/COMMIT;/gi, '');

const applyMigrations = async (pool: Pool) => {
  const migrations = getMigrations();
  for (const file of migrations) {
    const raw = fs.readFileSync(file, 'utf8');
    const sql = sanitizeSql(raw);
    const statements = sql
      .split(/;\s*/gm)
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await pool.query(statement);
    }
  }
};

describe('Memory Layer Transaction (Mock DB)', () => {
  let pool: Pool;

  beforeAll(() => {
    process.env.AUDIT_SIGNING_KEY = 'unit-test-secret';
  });

  beforeEach(async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true });

    // Mock functions needed by schema/queries
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: db.public.getType('uuid') as any,
      implementation: () => randomUUID(),
      impure: true
    });

    db.public.registerFunction({
        name: 'hashtext',
        args: [db.public.getType('text') as any],
        returns: db.public.getType('int') as any,
        implementation: (t: string) => {
            // Simple hash for mock
            let h = 0;
            for(let i=0; i<t.length; i++) h = Math.imul(31, h) + t.charCodeAt(i) | 0;
            return h;
        }
    });

    db.public.registerFunction({
        name: 'pg_advisory_xact_lock',
        args: [db.public.getType('int') as any],
        returns: db.public.getType('int') as any,
        implementation: () => 0
    });

    db.public.registerFunction({
      name: 'char_length',
      args: [db.public.getType('text') as any],
      returns: db.public.getType('int4') as any,
      implementation: (value: string | null) => (value ?? '').length
    });

    db.public.registerFunction({
        name: 'make_interval',
        args: [db.public.getType('int') as any],
        returns: db.public.getType('interval') as any,
        implementation: (s: number) => ({ seconds: s })
    });

    db.public.registerFunction({
      name: 'make_interval',
      args: [
        db.public.getType('int'),
        db.public.getType('int'),
        db.public.getType('int'),
        db.public.getType('int'),
        db.public.getType('int'),
        db.public.getType('int'),
        db.public.getType('int')
      ] as any,
      returns: db.public.getType('interval') as any,
      implementation: (y: number, mon: number, w: number, d: number, h: number, m: number, s: number) => {
        return { years: y, months: mon, weeks: w, days: d, hours: h, minutes: m, seconds: s };
      }
    });

    const pg = db.adapters.createPg();
    pool = new pg.Pool();
    setPool(pool);
    await applyMigrations(pool);
  });

  afterEach(async () => {
    await pool?.end();
    setPool(null);
  });

  test('insertMemoryNodeWithAudit should be atomic and idempotent', async () => {
    const owner = `test-owner-${Date.now()}`;
    const requestId = randomUUID();
    const input: MemoryNodeInput = {
      owner,
      metadata: { key: 'value' },
      requestId,
      ttlSeconds: 3600,
      artifacts: [
        {
          artifactUrl: 's3://bucket/test-artifact',
          sha256: 'a'.repeat(64),
          manifestSignatureId: 'sig-123',
          sizeBytes: 123
        }
      ]
    };

    // First Call
    const res1 = await insertMemoryNodeWithAudit(input, 'test.event', { foo: 'bar' });
    expect(res1.node.owner).toBe(owner);
    expect(res1.audit.id).toBeDefined();

    // Verify DB state
    const nodes = await pool.query('SELECT * FROM memory_nodes WHERE id = $1', [res1.node.id]);
    expect(nodes.rows.length).toBe(1);

    const audit = await pool.query('SELECT * FROM audit_events WHERE memory_node_id = $1', [res1.node.id]);
    expect(audit.rows.length).toBe(1);

    const artifacts = await pool.query('SELECT * FROM artifacts WHERE memory_node_id = $1', [res1.node.id]);
    expect(artifacts.rows.length).toBe(1);

    const processed = await pool.query('SELECT * FROM processed_requests WHERE request_id = $1', [requestId]);
    expect(processed.rows.length).toBe(1);

    // Idempotent Replay
    const res2 = await insertMemoryNodeWithAudit(input, 'test.event', { foo: 'bar' });
    expect(res2.node.id).toBe(res1.node.id);
    expect(res2.audit.id).toBe(res1.audit.id);
  });

  test('insertMemoryNodeWithAudit should rollback on failure', async () => {
    const owner = `fail-owner-${Date.now()}`;
    const input: MemoryNodeInput = {
      owner,
      metadata: {},
      artifacts: [
        {
          artifactUrl: 's3://bucket/fail',
          sha256: 'a'.repeat(64),
          manifestSignatureId: 'sig',
        }
      ]
    };

    // Force failure by mocking client.query to throw
    // But we are using the real pool from pg-mem.
    // We can use a trick: pass invalid JSON to metadata?
    // Or simpler: We can mock signAuditDigest to throw, which happens inside the transaction.

    // Since we can't easily change the mock for *just* this test without setup/teardown complexities,
    // let's try to trigger a unique constraint violation that IS NOT handled by ON CONFLICT.
    // memory_nodes has unique embedding_id.

    // First insert:
    await insertMemoryNodeWithAudit({...input, embeddingId: 'unique-1'}, 'test.event', {});

    // Second insert with SAME embeddingId, should fail (memory_nodes has UNIQUE(embedding_id))
    // And insertMemoryNode logic does not have ON CONFLICT for memory_nodes.
    await expect(insertMemoryNodeWithAudit({...input, embeddingId: 'unique-1', owner: 'other'}, 'test.event', {}))
      .rejects.toThrow();

    // Verify rollback: the second node should not be in DB.
    const nodes = await pool.query('SELECT * FROM memory_nodes WHERE owner = $1', ['other']);
    expect(nodes.rows.length).toBe(0);
  });

});
