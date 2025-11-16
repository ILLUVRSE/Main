"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pg_mem_1 = require("pg-mem");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const memoryService_1 = require("../services/memoryService");
const vectorDbAdapter_1 = require("../vector/vectorDbAdapter");
const migrations = [
    node_path_1.default.join(__dirname, '../../sql/migrations/001_create_memory_schema.sql'),
    node_path_1.default.join(__dirname, '../../sql/migrations/002_enhance_memory_vectors.sql')
];
const sanitizeSql = (sql) => sql
    .replace(/CREATE EXTENSION IF NOT EXISTS [^;]+;/gi, '')
    .replace(/BEGIN;/gi, '')
    .replace(/COMMIT;/gi, '');
const applyMigrations = async (pool) => {
    for (const file of migrations) {
        const raw = node_fs_1.default.readFileSync(file, 'utf8');
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
    let pool;
    beforeAll(() => {
        process.env.AUDIT_SIGNING_KEY = 'unit-test-secret';
    });
    beforeEach(async () => {
        const db = (0, pg_mem_1.newDb)({ autoCreateForeignKeyIndices: true });
        db.public.registerFunction({
            name: 'gen_random_uuid',
            returns: 'uuid',
            implementation: () => (0, node_crypto_1.randomUUID)(),
            impure: true
        });
        db.public.registerFunction({
            name: 'char_length',
            args: ['text'],
            returns: 'int4',
            implementation: (value) => (value ?? '').length
        });
        const pg = db.adapters.createPg();
        pool = new pg.Pool();
        (0, db_1.setPool)(pool);
        await applyMigrations(pool);
    });
    afterEach(async () => {
        await pool?.end();
        (0, db_1.setPool)(null);
    });
    it('chains audit events and produces signatures', async () => {
        const first = await (0, db_1.insertAuditEvent)({
            eventType: 'test.audit.one',
            payload: { foo: 'bar' }
        });
        const second = await (0, db_1.insertAuditEvent)({
            eventType: 'test.audit.two',
            payload: { foo: 'baz' }
        });
        expect(first.hash).toBeTruthy();
        expect(second.prev_hash).toEqual(first.hash);
        expect(second.signature).toBeTruthy();
    });
    it('persists nodes, artifacts, and vector search results', async () => {
        const vectorAdapter = new vectorDbAdapter_1.VectorDbAdapter({
            pool,
            namespace: 'test-memory',
            provider: 'pg-mem'
        });
        const memoryService = (0, memoryService_1.createMemoryService)({ vectorAdapter });
        const ctx = { caller: 'jest', manifestSignatureId: 'sig-node-1' };
        const { memoryNodeId } = await memoryService.createMemoryNode({
            owner: 'kernel',
            ttlSeconds: 4000,
            metadata: { topic: 'mission-brief' },
            embedding: {
                model: 'text-embedding',
                dimension: 3,
                vector: [0, 1, 0]
            }
        }, ctx);
        const checksum = 'a'.repeat(64);
        const artifact = await memoryService.createArtifact(memoryNodeId, {
            artifactUrl: 's3://bucket/doc.pdf',
            sha256: checksum,
            manifestSignatureId: 'sig-art-1'
        }, ctx);
        expect(artifact.artifactId).toBeTruthy();
        const vectorRows = await pool.query('SELECT memory_node_id, namespace, status FROM memory_vectors');
        expect(vectorRows.rows).toHaveLength(1);
        expect(vectorRows.rows[0].namespace).toEqual('test-memory');
        expect(vectorRows.rows[0].status).toEqual('completed');
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
