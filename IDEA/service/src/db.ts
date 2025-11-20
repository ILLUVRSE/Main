import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from './config';

const cfg = getConfig();
export const isPgMem = process.env.USE_PGMEM === '1';

function createPool(): Pool {
  if (isPgMem) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { newDb } = require('pg-mem');
    const mem = newDb();
    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: 'uuid',
      implementation: () => uuidv4()
    });
    const pgMem = mem.adapters.createPg();
    return new pgMem.Pool();
  }
  return new Pool({
    connectionString: cfg.databaseUrl,
    max: 10
  });
}

export const pool = createPool();

if (!isPgMem) {
  pool.on('error', (err) => {
    console.error('[idea-db] Unexpected error on idle client', err);
  });
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!isPgMem) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        prev_hash TEXT,
        hash TEXT NOT NULL UNIQUE,
        signature TEXT NOT NULL,
        signer_kid TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS idea_packages (
        id UUID PRIMARY KEY,
        package_name TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        s3_key TEXT,
        upload_url TEXT,
        sha256 TEXT,
        size_bytes BIGINT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS idea_manifests (
        id UUID PRIMARY KEY,
        package_id UUID NOT NULL REFERENCES idea_packages(id),
        status TEXT NOT NULL,
        impact TEXT NOT NULL,
        preconditions JSONB NOT NULL,
        manifest_signature_id TEXT,
        kernel_response JSONB,
        signed_payload JSONB,
        multisig_threshold INT DEFAULT 0,
        multisig_required INT DEFAULT 0,
        applied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS idea_manifest_approvals (
        id UUID PRIMARY KEY,
        manifest_id UUID NOT NULL REFERENCES idea_manifests(id) ON DELETE CASCADE,
        approver_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS idea_publish_events (
        id UUID PRIMARY KEY,
        manifest_id UUID NOT NULL REFERENCES idea_manifests(id),
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
