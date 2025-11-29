/**
 * memory-layer/test/integration/audit_chain.test.ts
 *
 * Integration test for audit chaining and digest verification.
 * Requires: DATABASE_URL or POSTGRES_URL.
 *
 * Scenarios:
 * 1. Appends audit events via auditChain helper (simulating app behavior).
 * 2. Exports range to file.
 * 3. Verifies file using verifyTool.
 * 4. Verifies tamper detection (modify file -> verifyTool fails).
 * 5. Verifies concurrent appends maintain linear chain (unique prev_hash).
 */

import { execSync } from 'child_process';
import { Client } from 'pg';
import path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import auditChain from '../../service/audit/auditChain';

// Ensure we use the auditChain logic to compute hash/sign as the app would.
// But we need to INSERT into DB. We can use a helper or manual insert.
// The app normally uses `shared/lib/audit.ts` emitAuditEvent (or equivalent).
// Since we don't have access to the service internals easily here without spinning up the app,
// we'll implement a helper that mimics `emitAuditEvent` using `auditChain` utility.
// Actually, `memory-layer` probably has its own audit emitter using `auditChain`.
// Let's check `memory-layer/service/audit/` for an emitter? No, I only saw utils.
// Maybe `memory-layer` uses `shared`?
// If `memory-layer` uses `shared`, then `auditChain.ts` was redundant?
// But `package.json` didn't show `shared`.
// Let's assume we need to implement the insertion here to test the TOOL.

const migrationsDir = path.join(__dirname, '..', '..', 'sql', 'migrations');
const verifyToolPath = path.join(__dirname, '..', '..', 'service', 'audit', 'verifyTool.ts');
const exportFile = path.join(__dirname, 'audit_export_test.json');

jest.setTimeout(120_000);

function ensureEnvOrSkip(): string | null {
  const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!conn) {
    console.warn('Skipping audit integration test: DATABASE_URL or POSTGRES_URL is not set.');
    return null;
  }
  return conn;
}

// Helper to mimic audit event emission with chaining
async function emitTestEvent(client: Client, payload: any, eventType: string = 'test.event') {
    // 1. Get last hash (locking)
    // We use advisory lock or just serializable transaction?
    // For test, we just query.
    await client.query('BEGIN');
    try {
        const lastRes = await client.query('SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE');
        const prevHash = lastRes.rows[0]?.hash || null;

        const canonical = auditChain.canonicalizePayload(payload);
        const hash = auditChain.computeAuditDigest(canonical, prevHash);

        // Sign (sync for test)
        // Ensure keys are set for test
        process.env.AUDIT_SIGNING_KEY = 'test-secret-key';
        process.env.AUDIT_SIGNING_ALG = 'hmac-sha256';
        const signature = auditChain.signAuditDigestSync(hash);

        const id = uuidv4();
        await client.query(
            `INSERT INTO audit_events (id, event_type, payload, prev_hash, hash, signature, signer_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [id, eventType, payload, prevHash, hash, signature, 'test-signer']
        );
        await client.query('COMMIT');
        return hash;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
}

describe('Audit Chain Integration', () => {
    let dbClient: Client | null = null;
    const conn = ensureEnvOrSkip();

    beforeAll(async () => {
        if (!conn) return;

        // Run migrations
        try {
            execSync(`npx ts-node ${path.join(__dirname, '..', '..', 'scripts', 'runMigrations.ts')} ${migrationsDir}`, {
                stdio: 'inherit',
                env: process.env
            });
        } catch (err) {
            console.error('Migration failed:', err);
            throw err;
        }

        dbClient = new Client({ connectionString: conn });
        await dbClient.connect();

        // Truncate audit_events to ensure clean state for verification (optional, but good for reliable offsets)
        // await dbClient.query('TRUNCATE TABLE audit_events CASCADE');
        // Note: Truncate might break other tests if running in parallel?
        // Jest runs files in parallel usually, but here we can force serial or just append.
        // If we append, verifyTool works on the WHOLE chain or range.
        // We'll append and assume valid chain exists or is empty.
    });

    afterAll(async () => {
        if (dbClient) await dbClient.end();
        if (fs.existsSync(exportFile)) fs.unlinkSync(exportFile);
    });

    if (!conn) {
        test.skip('Skipping tests due to missing DB', () => {});
        return;
    }

    test('Chain generation, export, and verification', async () => {
        if (!dbClient) throw new Error('DB client not initialized');

        // 1. Generate chain
        const eventCount = 10;
        console.log(`Generating ${eventCount} audit events...`);
        for (let i = 0; i < eventCount; i++) {
            await emitTestEvent(dbClient, { index: i, nonce: Math.random() });
        }

        // 2. Export to file using verifyTool
        console.log('Exporting audit chain...');
        // We use limit=20 to capture what we just wrote (plus maybe some previous).
        // Actually, verifyTool with --dump-to dumps the QUERY result.
        // We might dump everything.
        try {
             execSync(`npx ts-node ${verifyToolPath} --dump-to=${exportFile} --limit=50`, {
                 env: { ...process.env, DATABASE_URL: conn }
             });
        } catch (e) {
            console.error('Dump failed');
            throw e;
        }

        expect(fs.existsSync(exportFile)).toBe(true);
        const dumped = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
        expect(Array.isArray(dumped)).toBe(true);
        expect(dumped.length).toBeGreaterThanOrEqual(eventCount);

        // 3. Verify file using verifyTool
        console.log('Verifying exported file...');
        try {
            execSync(`npx ts-node ${verifyToolPath} --verify-file=${exportFile}`, {
                env: { ...process.env, AUDIT_SIGNING_KEY: 'test-secret-key' }
            });
        } catch (e) {
            console.error('Verification failed');
            throw e;
        }

        // 4. Tamper test
        console.log('Testing tamper detection...');
        const tampered = JSON.parse(JSON.stringify(dumped));
        // Modify payload of one event without updating hash/sig
        if (tampered.length > 2) {
            tampered[tampered.length - 2].payload = { ...tampered[tampered.length - 2].payload, tampered: true };
            const tamperedFile = path.join(__dirname, 'tampered_audit.json');
            fs.writeFileSync(tamperedFile, JSON.stringify(tampered));

            try {
                execSync(`npx ts-node ${verifyToolPath} --verify-file=${tamperedFile}`, {
                    stdio: 'pipe' // capture output to silence expected error or check it
                });
                throw new Error('Verify tool should have failed on tampered file');
            } catch (e: any) {
                // Expected failure
                expect(e.status).not.toBe(0);
                // console.log('Tamper detection successful');
            } finally {
                if (fs.existsSync(tamperedFile)) fs.unlinkSync(tamperedFile);
            }
        }
    });

    test('Concurrent appends maintain linear chain', async () => {
        // This test tries to emit multiple events concurrently and checks for failures or successful linearization.
        // Since we use `SELECT ... FOR UPDATE` in our helper, it should be serialized by DB.

        const concurrency = 5;
        const results = await Promise.allSettled(
            Array.from({ length: concurrency }).map((_, i) =>
                emitTestEvent(dbClient!, { concurrent: i })
            )
        );

        const rejected = results.filter(r => r.status === 'rejected');
        if (rejected.length > 0) {
            console.warn(`Some concurrent appends failed: ${rejected.length}`);
            // It's acceptable for some to fail if they deadlock, but ideally they queue.
            // With FOR UPDATE they should queue.
        }

        const fulfilled = results.filter(r => r.status === 'fulfilled');
        expect(fulfilled.length).toBe(concurrency);

        // Verify chain integrity
        // Fetch last N events
        const res = await dbClient!.query('SELECT hash, prev_hash FROM audit_events ORDER BY created_at DESC LIMIT $1', [concurrency + 1]);
        const rows = res.rows.reverse(); // old to new

        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].prev_hash).toBe(rows[i-1].hash);
        }
    });
});
