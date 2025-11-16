"use strict";
/**
 * memory-layer/scripts/runMigrations.ts
 *
 * Simple migration runner for the Memory Layer.
 *
 * Usage:
 *   DATABASE_URL=... npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations
 *
 * Behavior:
 *  - Reads SQL files from the given directory (default: memory-layer/sql/migrations).
 *  - Sorts them lexicographically and executes each file's contents against DATABASE_URL.
 *  - Skips files that have already been recorded in a `schema_migrations` table.
 *  - If `schema_migrations` table doesn't exist, it will be created by this script.
 *  - Runs each migration inside a transaction, marking `schema_migrations` on success.
 *
 * Notes:
 *  - Migration files are expected to be idempotent, but running them inside a transaction
 *    ensures partial failures do not leave the DB half-applied.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pg_1 = require("pg");
const argv = process.argv.slice(2);
const migrationsDir = argv[0] ?? path_1.default.join(__dirname, '..', 'sql', 'migrations');
function log(...args) {
    // simple logger that prefixes timestamp
    console.log(new Date().toISOString(), '-', ...args);
}
async function ensureMigrationsTable(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}
async function listAppliedMigrations(client) {
    const res = await client.query('SELECT id FROM schema_migrations');
    return new Set(res.rows.map((r) => r.id));
}
async function applyMigration(client, id, filename, sql) {
    // Run migration inside a transaction
    await client.query('BEGIN');
    try {
        await client.query(sql);
        // Record applied migration
        await client.query('INSERT INTO schema_migrations(id, filename) VALUES ($1, $2)', [id, filename]);
        await client.query('COMMIT');
        log(`applied migration ${filename}`);
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
}
function readSqlFiles(dir) {
    if (!fs_1.default.existsSync(dir)) {
        throw new Error(`migrations directory does not exist: ${dir}`);
    }
    const files = fs_1.default.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    files.sort(); // lexicographic order, assumes files prefixed with sequence numbers
    return files.map((filename) => {
        const fullpath = path_1.default.join(dir, filename);
        const sql = fs_1.default.readFileSync(fullpath, { encoding: 'utf8' });
        // Use filename as id (you may change to sha if needed)
        const id = filename;
        return { id, filename, fullpath, sql };
    });
}
async function main() {
    const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connStr) {
        console.error('ERROR: set DATABASE_URL or POSTGRES_URL');
        process.exit(2);
    }
    log('starting migration runner');
    log('migrations directory:', migrationsDir);
    const client = new pg_1.Client({ connectionString: connStr });
    await client.connect();
    try {
        await ensureMigrationsTable(client);
        const applied = await listAppliedMigrations(client);
        const files = readSqlFiles(migrationsDir);
        const pending = files.filter((f) => !applied.has(f.id));
        if (!pending.length) {
            log('no pending migrations; exiting.');
            return;
        }
        log(`found ${pending.length} pending migration(s)`);
        for (const mig of pending) {
            log(`running migration ${mig.filename} ...`);
            try {
                await applyMigration(client, mig.id, mig.filename, mig.sql);
            }
            catch (err) {
                console.error(`migration ${mig.filename} failed:`, err.message || err);
                console.error('stopping further migrations.');
                process.exitCode = 1;
                return;
            }
        }
        log('all pending migrations applied successfully');
    }
    catch (err) {
        console.error('migration runner failed:', err.message || err);
        process.exitCode = 1;
    }
    finally {
        await client.end();
    }
}
if (require.main === module) {
    main().catch((err) => {
        console.error('unhandled error in migration runner:', err);
        process.exit(1);
    });
}
