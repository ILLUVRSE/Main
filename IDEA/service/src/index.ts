import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import { getConfig } from './config';
import { enforceStartupGuards } from '../../../infra/startupGuards';
import { runMigrations, pool } from './db';
import authPlugin from './plugins/auth';
import metricsPlugin from './plugins/metrics';
import packagesRoutes from './routes/packages';
import manifestRoutes from './routes/manifests';
import publishRoutes from './routes/publish';
import healthRoutes from './routes/health';

const config = getConfig();
enforceStartupGuards({ serviceName: 'idea-service' });

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(helmet);
  await app.register(cors, { origin: true });
  await app.register(sensible);
  await app.register(authPlugin, { jwtSecret: config.authJwtSecret, demoToken: config.demoToken });
  await app.register(metricsPlugin);
  await app.register(healthRoutes);
  await app.register(packagesRoutes);
  await app.register(manifestRoutes);
  await app.register(publishRoutes);
  return app;
}

export async function start() {
  await runMigrations();
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  return app;
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
