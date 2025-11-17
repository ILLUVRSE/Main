import { Pool, PoolConfig, QueryResult } from 'pg';

let pool: Pool | null = null;

function createPool(): Pool {
  if (pool) return pool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Please configure a Postgres connection string in env.');
  }

  const cfg: PoolConfig = {
    connectionString: databaseUrl,
    // Optional tuning (can be overridden via env in production)
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 5000),
  };

  pool = new Pool(cfg);

  // Basic error logging
  pool.on('error', (err: Error) => {
    // eslint-disable-next-line no-console
    console.error('Unexpected error on idle Postgres client', err && err.stack ? err.stack : err);
  });

  return pool;
}

/**
 * Run a query against Postgres.
 * @param text SQL text
 * @param params optional params
 */
export async function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  const p = createPool();
  return p.query(text, params || []);
}

/**
 * Get the underlying Pool (for transactions).
 */
export function getPool(): Pool {
  return createPool();
}

/**
 * Close pool gracefully (useful in tests or shutdown).
 */
export async function close(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } finally {
      pool = null;
    }
  }
}

export default {
  query,
  getPool,
  close,
};

