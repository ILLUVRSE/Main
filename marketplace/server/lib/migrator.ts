/**
 * migrator.ts
 *
 * Simple SQL migrator that applies files in marketplace/sql/*.sql to a Postgres database.
 * - Looks for files named with a numeric prefix (e.g. 001_create_schema.sql) and applies them in order.
 * - Maintains a schema_migrations table to record applied migration filenames.
 *
 * This is intentionally lightweight and safe for development. For production usage,
 * prefer a battle-tested migration tool (Flyway, Liquibase, Sqitch, or node-pg-migrate).
 *
 * Usage:
 *   await runMigrations(process.env.DATABASE_URL);
 *
 * When executed directly it will attempt to use DATABASE_URL from env.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger';

const SQL_DIR = path.join(__dirname, '..', '..', 'sql');

async function listMigrationFiles(): Promise<string[]> {
  try {
    const files = await fs.promises.readdir(SQL_DIR);
    return files
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .sort((a, b) => {
        // try numeric prefix sort then lexicographic
        const aNum = parseInt(a.split('_')[0], 10);
        const bNum = parseInt(b.split('_')[0], 10);
        if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
        return a.localeCompare(b);
      });
  } catch (err) {
    logger.error('migrator.listMigrationFiles.failed', { err, dir: SQL_DIR });
    return [];
  }
}

/**
 * Create or verify schema_migrations table exists.
 */
async function ensureMigrationsTable(client: any) {
  const q = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `;
  await client.query(q);
}

/**
 * Return set of applied migration filenames.
 */
async function getAppliedMigrations(client: any): Promise<Set<string>> {
  const res = await client.query('SELECT filename FROM schema_migrations');
  const set = new Set<string>();
  for (const row of res.rows || []) {
    if (row && row.filename) set.add(String(row.filename));
  }
  return set;
}

/**
 * Apply a single migration file.
 */
async function applyMigrationFile(client: any, filename: string) {
  const filePath = path.join(SQL_DIR, filename);
  const sql = await fs.promises.readFile(filePath, { encoding: 'utf-8' });
  // Execute as a single query. If the file contains multiple statements
  // separated by semicolons, pg will handle them if allowed.
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    logger.info('migrator.applied', { filename });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('migrator.apply.failed', { err, filename });
    throw err;
  }
}

/**
 * Run pending migrations against the provided database URL.
 * If pg is not installed or DATABASE_URL is not provided, the function will log and no-op.
 */
export async function runMigrations(databaseUrl?: string) {
  const dbUrl = databaseUrl || process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.warn('migrator.no_database_url', { message: 'DATABASE_URL not provided - skipping migrations' });
    return { ok: false, reason: 'no_database_url' };
  }

  // Lazy import pg to avoid hard dependency in environments that don't need DB
  let pg: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pg = require('pg');
  } catch (err) {
    logger.warn('migrator.pg_not_installed', { err });
    return { ok: false, reason: 'pg_not_installed' };
  }

  const { Client } = pg;
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files = await listMigrationFiles();

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      logger.info('migrator.no_pending', { totalFiles: files.length });
      await client.end();
      return { ok: true, applied: [], pending: [] };
    }

    const appliedList: string[] = [];

    for (const f of pending) {
      logger.info('migrator.applying', { filename: f });
      try {
        await applyMigrationFile(client, f);
        appliedList.push(f);
      } catch (err) {
        logger.error('migrator.failed', { err, filename: f });
        await client.end();
        return { ok: false, error: err, applied: appliedList, pending: pending.slice(appliedList.length) };
      }
    }

    await client.end();
    return { ok: true, applied: appliedList, pending: [] };
  } catch (err) {
    logger.error('migrator.run.failed', { err });
    try {
      await client.end();
    } catch {
      // ignore
    }
    return { ok: false, error: err };
  }
}

/**
 * Get list of pending migrations without applying them.
 */
export async function getPendingMigrations(databaseUrl?: string) {
  const dbUrl = databaseUrl || process.env.DATABASE_URL;
  if (!dbUrl) {
    const files = await listMigrationFiles();
    return { ok: true, pending: files };
  }

  let pg: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pg = require('pg');
  } catch (err) {
    logger.warn('migrator.pg_not_installed', { err });
    const files = await listMigrationFiles();
    return { ok: false, reason: 'pg_not_installed', pending: files };
  }

  const { Client } = pg;
  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files = await listMigrationFiles();
    const pending = files.filter((f) => !applied.has(f));
    await client.end();
    return { ok: true, pending };
  } catch (err) {
    logger.error('migrator.getPending.failed', { err });
    try {
      await client.end();
    } catch {
      // ignore
    }
    return { ok: false, error: err };
  }
}

// If executed directly, run migrations using env DATABASE_URL
if (require.main === module) {
  (async () => {
    try {
      const res = await runMigrations();
      if (res.ok) {
        logger.info('migrator.complete', { applied: res.applied || [] });
        process.exit(0);
      } else {
        logger.error('migrator.exit.error', { res });
        process.exit(1);
      }
    } catch (err) {
      logger.error('migrator.cli.failed', { err });
      process.exit(1);
    }
  })();
}

export default {
  runMigrations,
  getPendingMigrations,
};

