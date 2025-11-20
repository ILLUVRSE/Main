import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import client from 'prom-client';

const collectDefaultMetrics = client.collectDefaultMetrics;

const metricsPlugin: FastifyPluginAsync = async (app) => {
  collectDefaultMetrics({ prefix: 'idea_' });

  app.get('/metrics', async (_req, reply) => {
    const data = await client.register.metrics();
    reply.header('content-type', client.register.contentType).send(data);
  });
};

export const metricsRegistry = client.register;
export default fp(metricsPlugin, { name: 'idea-metrics' });
