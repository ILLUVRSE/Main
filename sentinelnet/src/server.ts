import express, { Request, Response, NextFunction } from 'express';
import { collectDefaultMetrics, Registry } from 'prom-client';
import dotenv from 'dotenv';
import checkRouter from './routes/check';
import policyRouter from './routes/policy';
import { loadConfig } from './config/env';
import logger from './logger';

// load .env early
dotenv.config();
const config = loadConfig();

const app = express();

// Basic Prometheus registry + default metrics
const registry = new Registry();
collectDefaultMetrics({ register: registry });

// Middleware
app.use(express.json({ limit: '1mb' }));

// Simple request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health & readiness
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'sentinelnet', env: config.nodeEnv });
});

app.get('/ready', (_req: Request, res: Response) => {
  // For now, always ready; later check DB/kafka readiness
  res.json({ ok: true });
});

// Metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', registry.contentType);
    const metrics = await registry.metrics();
    res.send(metrics);
  } catch (err) {
    logger.warn('failed to collect metrics', err);
    res.status(500).send('metrics error');
  }
});

// API routes
app.use('/sentinelnet/check', checkRouter);
app.use('/sentinelnet/policy', policyRouter);

// Generic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err && err.stack ? err.stack : err);
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || 'internal_server_error' });
});

if (require.main === module) {
  const port = config.port || 7602;
  app.listen(port, () => {
    logger.info(`SentinelNet service listening on port ${port} (env=${config.nodeEnv})`);
  });

  // graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down SentinelNet...');
    // if you hook DB/kafka, close them here
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;

