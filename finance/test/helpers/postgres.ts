import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const DEFAULT_URL = 'postgres://postgres:finance@127.0.0.1:5433/finance';

export async function setupDatabase(): Promise<Pool> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL;
  const pool = new Pool({ connectionString });
  const schemaPath = path.resolve(__dirname, '../../service/src/db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  await truncateAll(pool);
  return pool;
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE journal_lines, journal_entries, payout_approvals, payouts, proof_manifest RESTART IDENTITY CASCADE;');
}
