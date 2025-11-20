import type { FastifyInstance } from 'fastify';
import { pool } from '../db';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      reply.send({ ok: true });
    } catch (err) {
      reply.code(500).send({ ok: false, error: { code: 'db_unhealthy', message: (err as Error).message } });
    }
  });
}
