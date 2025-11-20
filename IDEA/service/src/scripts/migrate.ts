import { runMigrations, pool } from '../db';

async function main() {
  try {
    console.log('[idea-migrate] Running migrations...');
    await runMigrations();
    console.log('[idea-migrate] Migrations complete.');
  } catch (err) {
    console.error('[idea-migrate] Migration failed', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
