import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import checkRouter from './routes/check';
import policyRouter from './routes/policy';
import { loadConfig } from './config/env';
import logger from './logger';
import metrics from './metrics/metrics';
import healthRouter from './health/health';
import eventConsumer from './event/consumer';
import auditEventHandler from './event/handler';
import rbac from './http/rbac';
import kafkaConsumer from './event/kafkaConsumer';

// load .env early
dotenv.config();
const config = loadConfig();

const app = express();

// Metrics registry (shared across modules)
metrics.registerMetrics();

// Middleware
app.use(express.json({ limit: '1mb' }));

// Simple request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health/readiness router
app.use(healthRouter);

// Metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const { contentType, body } = await metrics.metricsAsString();
    res.set('Content-Type', contentType);
    res.send(body);
  } catch (err) {
    logger.warn('failed to collect metrics', err);
    res.status(500).send('metrics error');
  }
});

// API routes
app.use('/sentinelnet/check', rbac.requireRole('check'), checkRouter);
app.use('/sentinelnet/policy', rbac.requireRole('policy'), policyRouter);

// Generic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err && err.stack ? err.stack : err);
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || 'internal_server_error' });
});

let stopAuditConsumer: (() => Promise<void>) | null = null;

function auditConsumerEnabled(): boolean {
  const flag = String(process.env.SENTINEL_ENABLE_AUDIT_CONSUMER || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(flag);
}

async function startAuditConsumerIfEnabled() {
  if (!auditConsumerEnabled()) {
    return;
  }
  try {
    if (kafkaConsumer.isKafkaEnabled()) {
      stopAuditConsumer = await kafkaConsumer.startKafkaConsumer(auditEventHandler.handleAuditEvent);
      logger.info('Audit consumer started (Kafka mode)');
    } else {
      stopAuditConsumer = eventConsumer.startConsumer(auditEventHandler.handleAuditEvent);
      logger.info('Audit consumer started (polling kernel audit events)');
    }
  } catch (err) {
    logger.warn('Failed to start audit consumer', err);
  }
}

if (require.main === module) {
  const port = config.port || 7602;
  app.listen(port, () => {
    logger.info(`SentinelNet service listening on port ${port} (env=${config.nodeEnv})`);
  });
  startAuditConsumerIfEnabled().catch((err) => logger.warn('audit consumer boot failure', err));

  // graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down SentinelNet...');
    try {
      if (stopAuditConsumer) {
        await stopAuditConsumer();
      }
    } catch (err) {
      logger.warn('Error while stopping audit consumer', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
