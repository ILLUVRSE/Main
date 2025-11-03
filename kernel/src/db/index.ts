/**
 * kernel/src/db/index.ts
 *
 * Postgres client and migration runner for Kernel module.
 */

import { Pool, QueryResult, PoolClient, QueryResultRow } from 'pg';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

const POSTGRES_URL = process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/illuvrse';

export const pool = new Pool({
  connectionString: POSTGRES_URL,
  max: 10,
});

/**
 * Simple helper to run a query using the shared pool.
 * T is constrained to QueryResultRow so pg types align.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Get a dedicated client (useful for transactions).
 * Remember to release the client after use.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * runMigrations
 * Reads SQL files from kernel/sql/migrations (relative to project root) and executes them in sorted order.
 */
export async function runMigrations(): Promise<void> {
  const migrationsDir = path.resolve(__dirname, '../sql/migrations');
  try {
    const stat = await fsPromises.stat(migrationsDir);
    if (!stat.isDirectory()) {
      console.warn('Migrations path exists but is not a directory:', migrationsDir);
      return;
    }
  } catch (err) {
    console.warn('Migrations directory not found, skipping migrations:', migrationsDir);
    return;
  }

  const files = (await fsPromises.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.info('No migration files found in', migrationsDir);
    return;
  }

  const client = await getClient();
  try {
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = await fsPromises.readFile(fullPath, 'utf8');
      console.log(`Applying migration: ${file}`);
      try {
        await client.query(sql);
        console.log(`Migration applied: ${file}`);
      } catch (err) {
        console.error(`Migration failed (${file}):`, (err as Error).message || err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

/**
 * waitForDb
 */
export async function waitForDb(timeoutMs = 10_000, intervalMs = 500): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for Postgres at ${POSTGRES_URL}: ${(err as Error).message}`);
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
    } catch (err) {
      console.error('Migration runner failed:', err);
      process.exit(1);
    }
  })();
}

