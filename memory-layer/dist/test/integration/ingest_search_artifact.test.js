"use strict";
/**
 * memory-layer/test/integration/ingest_search_artifact.test.ts
 *
 * Integration test:
 *  - runs migrations (via memory-layer/scripts/runMigrations.ts),
 *  - starts memory-layer app (imported),
 *  - POST /v1/memory/nodes (with embedding),
 *  - POST /v1/memory/search to find the node,
 *  - GET /v1/memory/nodes/:id to inspect node,
 *  - verify an audit_event was emitted for the node.
 *
 * This test requires a running Postgres reachable at process.env.DATABASE_URL.
 * Use memory-layer/service/audit/ci-env-setup.sh in CI to provision a signing proxy or AUDIT_SIGNING_KEY.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const child_process_1 = require("child_process");
const pg_1 = require("pg");
const server_1 = __importDefault(require("../../service/server"));
const path_1 = __importDefault(require("path"));
jest.setTimeout(120000);
const migrationsDir = path_1.default.join(__dirname, '..', '..', 'sql', 'migrations');
function ensureEnvOrSkip() {
    const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!conn) {
        // If no DB, skip tests by returning null.
        // Tests will be considered skipped if we early-return in beforeAll.
        // Logging here for operator visibility.
        // eslint-disable-next-line no-console
        console.warn('Skipping integration test: DATABASE_URL or POSTGRES_URL is not set.');
        return null;
    }
    return conn;
}
describe('Memory Layer integration: ingest -> search -> audit', () => {
    let dbClient = null;
    beforeAll(async () => {
        const conn = ensureEnvOrSkip();
        if (!conn)
            return;
        // Apply migrations
        try {
            // eslint-disable-next-line no-console
            console.log('Running migrations for integration test...');
            (0, child_process_1.execSync)(`npx ts-node ${path_1.default.join(__dirname, '..', '..', 'scripts', 'runMigrations.ts')} ${migrationsDir}`, {
                stdio: 'inherit',
                env: process.env
            });
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to run migrations:', err.message || err);
            throw err;
        }
        dbClient = new pg_1.Client({ connectionString: conn });
        await dbClient.connect();
    });
    afterAll(async () => {
        if (dbClient) {
            await dbClient.end();
            dbClient = null;
        }
    });
    test('ingest a memory node, find it via search, and verify audit', async () => {
        const conn = ensureEnvOrSkip();
        if (!conn) {
            // Skip test gracefully
            return;
        }
        const devPrincipalHeader = {
            'X-Local-Dev-Principal': JSON.stringify({
                id: 'test-service',
                type: 'service',
                roles: ['memory:write', 'memory:read', 'read:pii']
            })
        };
        // Step 1: create a memory node with an embedding
        const embeddingVector = [0.12, -0.05, 0.9, 0.002];
        const createResp = await (0, supertest_1.default)(server_1.default)
            .post('/v1/memory/nodes')
            .set(devPrincipalHeader)
            .set('Idempotency-Key', 'test-ingest-1')
            .set('X-Service-Id', 'integration-test')
            .send({
            owner: 'integration-test',
            ttlSeconds: 3600,
            embedding: {
                model: 'test-model',
                dimension: embeddingVector.length,
                vector: embeddingVector
            },
            metadata: {
                topic: 'integration-test'
            }
        })
            .expect(201);
        expect(createResp.body).toBeDefined();
        const memoryNodeId = createResp.body.memoryNodeId;
        expect(memoryNodeId).toBeTruthy();
        expect(createResp.body.auditEventId).toBeTruthy();
        // Step 2: search for the node using the same vector
        const searchResp = await (0, supertest_1.default)(server_1.default)
            .post('/v1/memory/search')
            .set(devPrincipalHeader)
            .send({
            queryEmbedding: embeddingVector,
            topK: 5,
            namespace: 'kernel-memory'
        })
            .expect(200);
        expect(searchResp.body).toBeDefined();
        expect(Array.isArray(searchResp.body.results)).toBe(true);
        const results = searchResp.body.results;
        expect(results.length).toBeGreaterThanOrEqual(1);
        const top = results[0];
        expect(top.memoryNodeId).toBe(memoryNodeId);
        // Step 3: fetch the node
        const getResp = await (0, supertest_1.default)(server_1.default)
            .get(`/v1/memory/nodes/${memoryNodeId}`)
            .set(devPrincipalHeader)
            .expect(200);
        expect(getResp.body).toBeDefined();
        expect(getResp.body.memoryNodeId).toBe(memoryNodeId);
        expect(getResp.body.metadata).toBeDefined();
        expect(getResp.body.legalHold).toBe(false);
        // Step 4: verify an audit_event exists referencing the node
        const client = new pg_1.Client({ connectionString: conn });
        await client.connect();
        try {
            const auditQ = await client.query(`SELECT id, event_type, hash, prev_hash, signature, created_at FROM audit_events WHERE memory_node_id = $1 ORDER BY created_at DESC LIMIT 5`, [memoryNodeId]);
            expect(auditQ.rowCount).toBeGreaterThan(0);
            const auditRow = auditQ.rows[0];
            expect(auditRow.event_type).toMatch(/memory\.node\.created|memory\.node\./i);
            expect(auditRow.hash).toBeTruthy();
            // signature may be null in dev if no signer configured; assert presence of hash and chain
            if (auditRow.signature) {
                expect(typeof auditRow.signature).toBe('string');
            }
        }
        finally {
            await client.end();
        }
    });
});
