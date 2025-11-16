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

function enforceProdGuardrails() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const requireKms = String(process.env.REQUIRE_KMS || '').toLowerCase() === 'true';
  if (nodeEnv === 'production' && String(process.env.DEV_SKIP_MTLS || '').toLowerCase() === 'true') {
    logger.error('[startup] DEV_SKIP_MTLS=true is forbidden in production');
    process.exit(1);
  }
  if (nodeEnv === 'production' || requireKms) {
    const kmsConfigured = Boolean(process.env.SENTINEL_KMS_ENDPOINT || process.env.KMS_ENDPOINT);
    if (!kmsConfigured) {
      logger.error('[startup] KMS endpoint is required in production (set SENTINEL_KMS_ENDPOINT or KMS_ENDPOINT)');
      process.exit(1);
    }
  }
}

enforceProdGuardrails();

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
