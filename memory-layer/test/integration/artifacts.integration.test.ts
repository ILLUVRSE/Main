/**
 * memory-layer/test/integration/artifacts.integration.test.ts
 *
 * Integration tests for artifact provenance, checksums, and audit linkage.
 * Uses pg-mem for DB simulation if real DB not available, or real DB if provided.
 * Uses LocalFsArtifactStorage for storage simulation.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'node:fs/promises';
import path from 'node:path';
import { uploadArtifact } from '../../service/services/artifactService';
import { getPool, setPool, insertMemoryNode } from '../../service/db';
import { computeSha256 } from '../../service/storage/artifactStorage';
import { Pool } from 'pg';
import { newDb } from 'pg-mem';
import { v4 as uuidv4 } from 'uuid';

// Mock DB setup if no real DB
let pool: Pool;
let usingMockDb = false;

import { DataType } from 'pg-mem';

const setupMockDb = async () => {
    const db = newDb();

    // Register extensions and functions
    db.public.registerFunction({
        name: 'gen_random_uuid',
        returns: DataType.uuid,
        impure: true, // Mark as impure so it's called every time
        implementation: () => uuidv4()
    });
    db.public.registerFunction({
         name: 'make_interval',
         args: [DataType.integer],
         returns: DataType.interval,
         implementation: (secs: number) => ({ seconds: secs })
    });
    db.public.registerFunction({
        name: 'make_interval',
        args: [
            DataType.integer,
            DataType.integer,
            DataType.integer,
            DataType.integer,
            DataType.integer,
            DataType.integer,
            DataType.integer
        ],
        returns: DataType.interval,
        implementation: () => ({ seconds: 0 })
   });

   // Emulate jsonb_set
   db.public.registerFunction({
       name: 'jsonb_set',
       args: [
           DataType.jsonb,
           DataType.text, // pg-mem doesn't fully support text[] in args for custom functions sometimes, trying text for path?
                          // Or we might need to cast.
                          // Actually let's try just allowing it.
           DataType.jsonb,
           DataType.bool
       ],
       returns: DataType.jsonb,
       implementation: (target: any, pathArr: any, newVal: any, createMissing: boolean) => {
           return { ...target, ...newVal };
       }
   });

   // Register char_length
   db.public.registerFunction({
       name: 'char_length',
       args: [DataType.text],
       returns: DataType.integer,
       implementation: (str: string) => str ? str.length : 0
   });

    // Create Schema
    // We read the migration files
    const migrationsDir = path.join(__dirname, '../../sql/migrations');
    const files = await fs.readdir(migrationsDir);
    for (const file of files.sort()) {
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
        // Handle pgcrypto extension if present in sql
        // pg-mem doesn't support extensions but we can ignore create extension or mock functions if needed.
        // gen_random_uuid is already mocked.
        const safeSql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/g, '-- extension pgcrypto ignored');
        db.public.many(safeSql);
    }

    // Create pool adapter
    // The pg-mem adapter for pg returns { Client, Pool }
    const { Pool: MemPool } = db.adapters.createPg();
    pool = new MemPool();

    setPool(pool);
    usingMockDb = true;
};

const setupRealDb = () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    setPool(pool);
};

describe('Artifact Provenance Integration', () => {
    beforeAll(async () => {
        if (process.env.DATABASE_URL) {
            setupRealDb();
        } else {
            await setupMockDb();
        }

        // Cleanup storage
        const storageDir = process.env.ARTIFACT_STORAGE_DIR || 'memory-layer/test/storage';
        await fs.rm(storageDir, { recursive: true, force: true });
        await fs.mkdir(storageDir, { recursive: true });
    });

    afterAll(async () => {
        if (!usingMockDb) {
            await pool.end();
        }
    });

    it('should upload artifact, persist metadata, and link audit event', async () => {
        const content = Buffer.from('Hello World ' + Date.now());
        const filename = 'hello.txt';
        const ctx = {
            caller: 'test-user',
            manifestSignatureId: 'sig-123'
        };

        // Create a node first
        const node = await insertMemoryNode({
            owner: 'test-user',
            metadata: { type: 'test' }
        });

        const result = await uploadArtifact(node.id, content, filename, 'text/plain', ctx);

        expect(result.artifactId).toBeDefined();
        expect(result.auditId).toBeDefined();
        expect(result.sha256).toBe(computeSha256(content));

        // Verify DB
        const { rows: artRows } = await pool.query(`SELECT * FROM artifacts WHERE id = $1`, [result.artifactId]);
        expect(artRows.length).toBe(1);
        expect(artRows[0].sha256).toBe(result.sha256);
        expect(artRows[0].provenance_verified).toBe(true);

        // Verify Audit
        const { rows: auditRows } = await pool.query(`SELECT * FROM audit_events WHERE id = $1`, [result.auditId]);
        expect(auditRows.length).toBe(1);
        expect(auditRows[0].artifact_id).toBe(result.artifactId);
    });

    it('should handle deduplication (same content = same artifact entry or idempotent update)', async () => {
        const content = Buffer.from('Duplicate Content');
        const filename = 'dup.txt';
        const ctx = { caller: 'test-user' };

        const node = await insertMemoryNode({ owner: 'test-user' });

        const res1 = await uploadArtifact(node.id, content, filename, 'text/plain', ctx);
        // The second upload for the SAME node and SAME artifact might fail on unique key violation if we are not careful
        // The logic in uploadArtifact:
        // INSERT INTO artifacts ... ON CONFLICT (artifact_url, sha256) DO UPDATE ... RETURNING id

        // However, we are passing the SAME node.id.
        // The artifact table has memory_node_id.
        // Wait, the artifact table schema:
        // memory_node_id UUID REFERENCES memory_nodes(id) ON DELETE SET NULL,
        // artifact_url TEXT NOT NULL,
        // sha256 CHAR(64) NOT NULL,
        // UNIQUE INDEX idx_artifacts_url_sha ON artifacts(artifact_url, sha256);

        // If we upload the same content, we get the same SHA and same URL (if URL is deterministic).
        // uploadArtifact constructs URL as s3://.../artifacts/<sha256>
        // So URL is same.
        // So ON CONFLICT should trigger.

        // However, we also have memory_node_id. The artifact row is linked to A node.
        // If we upload for the SAME node, we just update the existing artifact row.
        // If we upload for a DIFFERENT node, we still hit the UNIQUE constraint on (artifact_url, sha256).
        // BUT the memory_node_id is just a foreign key. It is not part of the unique constraint.
        // If we update the row, we might change the memory_node_id if we pass a different one?
        // The logic is:
        // INSERT INTO artifacts (memory_node_id, ...) ... ON CONFLICT DO UPDATE SET ...
        // We do NOT update memory_node_id in the ON CONFLICT clause in our code.
        // So if an artifact exists, it stays linked to the ORIGINAL node.

        const res2 = await uploadArtifact(node.id, content, filename, 'text/plain', ctx);

        expect(res1.sha256).toBe(res2.sha256);
        expect(res1.artifactId).toBe(res2.artifactId);
        expect(res1.auditId).not.toBe(res2.auditId);
    });
});
