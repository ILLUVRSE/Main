import fs from 'node:fs';
import path from 'node:path';
import { Pool, PoolClient } from 'pg';

export interface DbConfig {
  connectionString: string;
}

type PoolLike = Pool;

export class KernelDb {
  private pool: PoolLike;

  constructor(config: DbConfig | { pool: PoolLike }) {
    if ('pool' in config) {
      this.pool = config.pool;
    } else {
      this.pool = new Pool({ connectionString: config.connectionString });
    }
  }

  async migrate(): Promise<void> {
    const migrationPath = path.resolve(__dirname, '..', '..', 'sql', 'migrations', '0001_init.sql');
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file missing: ${migrationPath}`);
    }
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await this.pool.query(sql);
  }

  async ready(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  getPool(): PoolLike {
    return this.pool;
  }
}
