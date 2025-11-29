
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { insertMemoryNodeWithAudit, setPool, getPool } from '../../service/db';
import { MemoryNodeInput } from '../../service/types';
import crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;

const isMock = DATABASE_URL && DATABASE_URL.includes('mock');
const describeRun = (DATABASE_URL && !isMock) ? describe : describe.skip;

if (!DATABASE_URL) {
  console.log('Skipping integration tests because DATABASE_URL is not set.');
} else if (isMock) {
  console.log('Skipping integration tests because DATABASE_URL is mock.');
}

describeRun('Memory Layer Integration', () => {
  let pool: Pool;

  beforeAll(async () => {
    // Reset DB state (assumes test DB)
    // We should probably rely on migration script running before this test.
    pool = new Pool({ connectionString: DATABASE_URL });
    setPool(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('migrations should have created tables', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `);
      const tables = res.rows.map(r => r.table_name);
      expect(tables).toContain('memory_nodes');
      expect(tables).toContain('artifacts');
      expect(tables).toContain('audit_events');
      expect(tables).toContain('processed_requests');
    } finally {
      client.release();
    }
  });

  test('insertMemoryNodeWithAudit should be atomic and idempotent', async () => {
    const owner = `test-owner-${Date.now()}`;
    const requestId = randomUUID();
    const input: MemoryNodeInput = {
      owner,
      metadata: { key: 'value' },
      requestId,
      artifacts: [
        {
          artifactUrl: 's3://bucket/test-artifact',
          sha256: crypto.createHash('sha256').update('test').digest('hex'),
          manifestSignatureId: 'sig-123',
          sizeBytes: 123
        }
      ]
    };

    // First Call
    const res1 = await insertMemoryNodeWithAudit(input, 'test.event', { foo: 'bar' });
    expect(res1.node.owner).toBe(owner);
    expect(res1.audit.event_type).toBe('test.event');

    // Verify DB state
    const client = await pool.connect();
    try {
      const nodes = await client.query('SELECT * FROM memory_nodes WHERE id = $1', [res1.node.id]);
      expect(nodes.rows.length).toBe(1);

      const audit = await client.query('SELECT * FROM audit_events WHERE memory_node_id = $1', [res1.node.id]);
      expect(audit.rows.length).toBe(1);

      const artifacts = await client.query('SELECT * FROM artifacts WHERE memory_node_id = $1', [res1.node.id]);
      expect(artifacts.rows.length).toBe(1);

      const processed = await client.query('SELECT * FROM processed_requests WHERE request_id = $1', [requestId]);
      expect(processed.rows.length).toBe(1);
    } finally {
      client.release();
    }

    // Idempotent Replay
    const res2 = await insertMemoryNodeWithAudit(input, 'test.event', { foo: 'bar' });
    expect(res2.node.id).toBe(res1.node.id);
    expect(res2.audit.id).toBe(res1.audit.id); // Should return same audit event
  });

  test('insertMemoryNodeWithAudit should rollback on failure', async () => {
    const owner = `fail-owner-${Date.now()}`;
    const input: MemoryNodeInput = {
      owner,
      metadata: {},
      // Force failure by using invalid artifact sha256 length if unchecked,
      // OR explicitly throwing error in DB.
      // But we can simulate failure by mocking inside types or causing constraint violation.
      // Let's use a SHA256 that is too long (if DB check exists).
      // The DB check `artifacts_sha256_length` checks length = 64.
      artifacts: [
        {
          artifactUrl: 's3://bucket/fail',
          sha256: 'bad-sha',
          manifestSignatureId: 'sig',
        }
      ]
    };

    await expect(insertMemoryNodeWithAudit(input, 'test.event', {}))
      .rejects.toThrow();

    // Verify rollback
    const client = await pool.connect();
    try {
      const nodes = await client.query('SELECT * FROM memory_nodes WHERE owner = $1', [owner]);
      expect(nodes.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });
});
