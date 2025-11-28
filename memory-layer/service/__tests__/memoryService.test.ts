import { newDb } from 'pg-mem';
import path from 'node:path';
import fs from 'node:fs';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { setPool, insertAuditEvent } from '../db';
import { createMemoryService } from '../services/memoryService';
import { VectorDbAdapter } from '../vector/vectorDbAdapter';

jest.mock('../storage/s3Client', () => ({
  validateArtifactChecksum: jest.fn().mockResolvedValue(true)
}));

const migrations = [
  path.join(__dirname, '../../sql/migrations/001_create_memory_schema.sql'),
  path.join(__dirname, '../../sql/migrations/002_enhance_memory_vectors.sql'),
  path.join(__dirname, '../../sql/migrations/003_create_reasoning_queue.sql')
];

const sanitizeSql = (sql: string) =>
  sql
    .replace(/CREATE EXTENSION IF NOT EXISTS [^;]+;/gi, '')
    .replace(/BEGIN;/gi, '')
    .replace(/COMMIT;/gi, '');

const applyMigrations = async (pool: Pool) => {
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

describe('Memory Layer service', () => {
  let pool: Pool;

  beforeAll(() => {
    process.env.AUDIT_SIGNING_KEY = 'unit-test-secret';
    process.env.VECTOR_DB_NAMESPACE = 'test-memory';
  });

  beforeEach(async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: db.public.getType('uuid') as any,
      implementation: () => randomUUID(),
      impure: true
    });
    db.public.registerFunction({
      name: 'char_length',
      args: [db.public.getType('text') as any],
      returns: db.public.getType('int4') as any,
      implementation: (value: string | null) => (value ?? '').length
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

  it('chains audit events and produces signatures', async () => {
    const first = await insertAuditEvent({
      eventType: 'test.audit.one',
      payload: { foo: 'bar' }
    });
    const second = await insertAuditEvent({
      eventType: 'test.audit.two',
      payload: { foo: 'baz' }
    });

    expect(first.hash).toBeTruthy();
    expect(second.prev_hash).toEqual(first.hash);
    expect(second.signature).toBeTruthy();
  });

  it('persists nodes, artifacts, and vector search results', async () => {
    const vectorAdapter = new VectorDbAdapter({
      pool,
      namespace: 'test-memory',
      provider: 'pg-mem'
    });
    const memoryService = createMemoryService({ vectorAdapter });

    const ctx = { caller: 'jest', manifestSignatureId: 'sig-node-1' };
    const { memoryNodeId } = await memoryService.createMemoryNode(
      {
        owner: 'kernel',
        ttlSeconds: 4000,
        metadata: { topic: 'mission-brief' },
        embedding: {
          model: 'text-embedding',
          dimension: 3,
          vector: [0, 1, 0]
        }
      },
      ctx
    );

    const checksum = 'a'.repeat(64);
    const artifact = await memoryService.createArtifact(
      memoryNodeId,
      {
        artifactUrl: 's3://bucket/doc.pdf',
        sha256: checksum,
        manifestSignatureId: 'sig-art-1'
      },
      ctx
    );

    expect(artifact.artifactId).toBeTruthy();

    // Verify pending status (Outbox pattern)
    const vectorRows = await pool.query('SELECT memory_node_id, namespace, status FROM memory_vectors');
    expect(vectorRows.rows).toHaveLength(1);
    expect(vectorRows.rows[0].namespace).toEqual('test-memory');
    expect(vectorRows.rows[0].status).toEqual('pending');

    // Verify reasoning queue insertion
    const reasonRows = await pool.query('SELECT memory_node_id, status FROM reasoning_graph_queue');
    expect(reasonRows.rows).toHaveLength(1);
    expect(reasonRows.rows[0].status).toEqual('pending');

    // Manually simulate worker success for vectors
    await pool.query("UPDATE memory_vectors SET status = 'completed'");

    const rawVectorResults = await vectorAdapter.search({
      queryEmbedding: [0, 1, 0],
      topK: 3
    });
    expect(rawVectorResults).toHaveLength(1);

    const search = await memoryService.searchMemoryNodes({
      queryEmbedding: [0, 1, 0],
      topK: 3,
      filter: { 'metadata.topic': ['mission-brief'] }
    });

    expect(search).toHaveLength(1);
    expect(search[0].artifactIds).toHaveLength(1);

    const nodeView = await memoryService.getMemoryNode(memoryNodeId);
    expect(nodeView?.artifacts[0]?.artifactId).toEqual(artifact.artifactId);

    const artifactView = await memoryService.getArtifact(artifact.artifactId);
    expect(artifactView?.sha256).toEqual(checksum);
    expect(artifactView?.latestAudit).toBeDefined();
  });
});
