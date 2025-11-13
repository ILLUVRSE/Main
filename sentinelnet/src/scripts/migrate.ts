// sentinelnet/src/scripts/migrate.ts
/**
 * Simple migration runner for SentinelNet.
 * Usage: `npm run migrate`
 *
 * This script loads env, runs migrations found under sql/migrations,
 * and exits with appropriate status.
 */
import dotenv from 'dotenv';
dotenv.config();

import db from '../db';
import logger from '../logger';

async function main() {
  try {
    logger.info('Starting SentinelNet migrations...');
    await db.runMigrations();
    logger.info('Migrations completed successfully.');
    // close pool if available
    await db.closePool?.();
    process.exit(0);
  } catch (err) {
    logger.error('Migrations failed', err);
    try {
      await db.closePool?.();
    } catch (e) {
      // ignore
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default main;

