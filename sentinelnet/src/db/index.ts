// sentinelnet/src/db/index.ts
import fs from 'fs';
import path from 'path';
import { Pool, QueryResult } from 'pg';
import logger from '../logger';
import { loadConfig } from '../config/env';

const config = loadConfig();

if (!config.dbUrl) {
  logger.warn('SENTINEL_DB_URL not set; DB functions will throw until configured (useful for tests)');
}

const pool = new Pool({
  connectionString: config.dbUrl || undefined,
  // tune pool if needed with env vars
  max: Number(process.env.SENTINEL_DB_MAX_CLIENTS || 10),
  idleTimeoutMillis: Number(process.env.SENTINEL_DB_IDLE_MS || 30000),
});

/**
 * Run SQL migrations found in sentinelnet/sql/migrations in lexical order.
 * Files should be named like 001_...sql, 002_...sql, etc.
 */
export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, '..', '..', 'sql', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.info('No migrations directory found, skipping migrations', { dir: migrationsDir });
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (!files.length) {
    logger.info('No migration files found, skipping migrations');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      logger.info('Applying migration', { file: fullPath });
      const sql = fs.readFileSync(fullPath, 'utf8');
      if (!sql.trim()) {
        logger.info('Skipping empty migration file', { file });
        continue;
      }
      await client.query(sql);
    }
    await client.query('COMMIT');
    logger.info('Migrations applied successfully', { count: files.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Migration failed', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Simple query helper
 */
export async function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  if (!config.dbUrl) {
    throw new Error('SENTINEL_DB_URL not configured');
  }
  try {
    return await pool.query(text, params);
  } catch (err) {
    logger.error('DB query error', { text: text?.slice?.(0, 200), params, error: (err as Error).message || err });
    throw err;
  }
}

/**
 * Close pool (useful for tests / shutdown)
 */
export async function closePool(): Promise<void> {
  await pool.end().catch((e: any) => {
    logger.warn('closePool error', (e as Error).message || e);
  });
}

export default {
  runMigrations,
  query,
  closePool,
};

