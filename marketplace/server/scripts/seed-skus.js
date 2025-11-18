#!/usr/bin/env node
/**
 * marketplace/server/scripts/seed-skus.js
 *
 * Usage:
 *   node scripts/seed-skus.js [DATABASE_URL]
 *
 * If DATABASE_URL is omitted the script will use the DATABASE_URL env var.
 *
 * This script requires `psql` be available in PATH (uses psql -f to apply the SQL).
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function usage() {
  console.error('');
  console.error('Usage: seed-skus.js [DATABASE_URL]');
  console.error('');
  console.error('Apply seed SQL (marketplace/data/e2e-skus.sql) to a Postgres DB.');
  console.error('');
  console.error('Examples:');
  console.error('  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/marketplace node scripts/seed-skus.js');
  console.error('  node scripts/seed-skus.js "postgres://postgres:postgres@127.0.0.1:5432/marketplace"');
  console.error('');
  process.exit(1);
}

async function main() {
  try {
    const dbUrl = process.argv[2] || process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error('ERROR: DATABASE_URL not provided.');
      usage();
    }

    // Resolve SQL path relative to this script: ../../data/e2e-skus.sql
    const sqlPath = path.resolve(__dirname, '..', '..', 'data', 'e2e-skus.sql');
    if (!fs.existsSync(sqlPath)) {
      console.error(`ERROR: Seed SQL file not found at ${sqlPath}`);
      process.exit(2);
    }

    // Check psql available
    const which = spawnSync('psql', ['--version'], { encoding: 'utf8' });
    if (which.error) {
      console.error('ERROR: psql is required but not found in PATH. Install postgresql client tools.');
      process.exit(3);
    }
    console.log(`[seed-skus] Applying ${sqlPath} to ${dbUrl}`);

    // Run psql with ON_ERROR_STOP so the script aborts on first SQL error
    // Note: pass DB URL as first arg is supported by psql (<connection-string>)
    const child = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], {
      stdio: 'inherit',
      encoding: 'utf8',
    });

    if (child.error) {
      console.error('[seed-skus] Failed to execute psql:', child.error);
      process.exit(4);
    }
    if (child.status !== 0) {
      console.error(`[seed-skus] psql exited with status ${child.status}`);
      process.exit(child.status || 5);
    }

    console.log('[seed-skus] Done.');
    process.exit(0);
  } catch (err) {
    console.error('[seed-skus] Unexpected error:', err);
    process.exit(99);
  }
}

main();

