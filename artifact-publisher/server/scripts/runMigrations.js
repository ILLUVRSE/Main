#!/usr/bin/env node
import { Client } from 'pg';

const dbUrl =
  process.env.ARTIFACT_PUBLISHER_DB_URL ||
  process.env.REPOWRITER_DB_URL ||
  'postgres://postgres:postgrespw@127.0.0.1:5433/artifact_publisher';

const failOnError = process.env.FAIL_ON_DB_ERROR === '1';

async function run() {
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    await client.query(
      `CREATE TABLE IF NOT EXISTS artifact_orders (
        order_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    );

    console.log('[migrations] artifact_orders ensured');
  } catch (error) {
    console.warn(`[migrations] skipped (${error.message})`);
    if (failOnError) {
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

run();
