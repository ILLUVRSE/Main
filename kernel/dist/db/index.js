"use strict";
/**
 * kernel/src/db/index.ts
 *
 * Postgres client and migration runner for Kernel module.
 *
 * Improvements:
 * - runMigrations now searches multiple candidate migration directories:
 *   1) ../sql/migrations (relative to compiled/dist code)
 *   2) kernel/sql/migrations (project-root)
 *   3) sql/migrations (project-root fallback)
 * - This makes `node kernel/dist/server.js` and the test runner resilient to
 *   where the process.cwd() is and avoids requiring SQL files to be copied into dist.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.getClient = getClient;
exports.runMigrations = runMigrations;
exports.waitForDb = waitForDb;
const pg_1 = require("pg");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const POSTGRES_URL = process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/illuvrse';
exports.pool = new pg_1.Pool({
    connectionString: POSTGRES_URL,
    max: 10,
});
/**
 * Simple helper to run a query using the shared pool.
 * T is constrained to QueryResultRow so pg types align.
 */
async function query(text, params) {
    return exports.pool.query(text, params);
}
/**
 * Get a dedicated client (useful for transactions).
 * Remember to release the client after use.
 */
async function getClient() {
    return exports.pool.connect();
}
/**
 * runMigrations
 * Reads SQL files from a migrations directory and executes them in sorted order.
 *
 * Directory resolution:
 * - Prefer path relative to compiled code: __dirname + '../sql/migrations'
 * - Fallback to likely project-root locations:
 *     - process.cwd()/kernel/sql/migrations
 *     - process.cwd()/sql/migrations
 *
 * The search is idempotent and logs which directory is used.
 */
async function runMigrations() {
    const candidates = [
        path_1.default.resolve(__dirname, '../sql/migrations'), // compiled/dist location
        path_1.default.resolve(process.cwd(), 'kernel/sql/migrations'), // project-root/kernel/sql/migrations
        path_1.default.resolve(process.cwd(), 'sql/migrations'), // project-root/sql/migrations (fallback)
    ];
    let migrationsDir = null;
    for (const c of candidates) {
        try {
            const stat = await promises_1.default.stat(c);
            if (stat.isDirectory()) {
                migrationsDir = c;
                break;
            }
        }
        catch {
            // ignore and continue to next candidate
        }
    }
    if (!migrationsDir) {
        console.warn('Migrations directory not found in any candidate paths. Searched:', candidates.join(', '));
        return;
    }
    console.info('Using migrations directory:', migrationsDir);
    const files = (await promises_1.default.readdir(migrationsDir))
        .filter((f) => f.endsWith('.sql'))
        .sort();
    if (!files.length) {
        console.info('No migration files found in', migrationsDir);
        return;
    }
    const client = await getClient();
    try {
        for (const file of files) {
            const fullPath = path_1.default.join(migrationsDir, file);
            const sql = await promises_1.default.readFile(fullPath, 'utf8');
            console.log(`Applying migration: ${file}`);
            try {
                await client.query(sql);
                console.log(`Migration applied: ${file}`);
            }
            catch (err) {
                console.error(`Migration failed (${file}):`, err.message || err);
                throw err;
            }
        }
    }
    finally {
        client.release();
    }
}
/**
 * waitForDb
 */
async function waitForDb(timeoutMs = 10_000, intervalMs = 500) {
    const start = Date.now();
    while (true) {
        try {
            await exports.pool.query('SELECT 1');
            return;
        }
        catch (err) {
            if (Date.now() - start > timeoutMs) {
                throw new Error(`Timed out waiting for Postgres at ${POSTGRES_URL}: ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, intervalMs));
        }
    }
}
/* If invoked directly run migrations */
if (require.main === module) {
    (async () => {
        try {
            console.log('Waiting for Postgres...');
            await waitForDb(30_000);
            console.log('Running migrations...');
            await runMigrations();
            console.log('Migrations complete.');
            process.exit(0);
        }
        catch (err) {
            console.error('Migration runner failed:', err);
            process.exit(1);
        }
    })();
}
