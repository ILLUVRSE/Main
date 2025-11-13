// sentinelnet/src/index.ts
/**
 * Module entry for programmatic use (tests/imports).
 * Exports the Express app and startup helpers.
 */

import app from './server';
import { loadConfig } from './config/env';
import metrics from './metrics/metrics';
import logger from './logger';
import { runMigrations } from './db';

const config = loadConfig();

export async function boot(opts?: { migrate?: boolean }) {
  try {
    if (opts?.migrate) {
      logger.info('boot: running migrations before start');
      await runMigrations();
    }

    // register metrics to global registry used by server if needed
    metrics.registerMetrics();

    const port = config.port || 7602;
    const server = app.listen(port, () => {
      logger.info(`SentinelNet (boot) listening on port ${port}`);
    });

    const shutdown = async () => {
      logger.info('SentinelNet shutting down');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return server;
  } catch (err) {
    logger.error('boot failed', err);
    throw err;
  }
}

export default app;

