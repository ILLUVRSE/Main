import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import jwt, { JwtPayload } from 'jsonwebtoken';

export interface AuthPluginOptions {
  jwtSecret?: string;
  demoToken?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    actorId?: string;
  }
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  app.decorateRequest('actorId', null);

  app.addHook('preHandler', async (req, reply) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/metrics')) {
      return;
    }

    const actorHeader = req.headers['x-actor-id'];
    if (typeof actorHeader === 'string' && actorHeader.trim()) {
      req.actorId = actorHeader.trim();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      reply.code(401).send({ ok: false, error: { code: 'unauthorized', message: 'Missing bearer token' } });
      return;
    }
    const token = authHeader.slice(7).trim();

    if (opts.demoToken && token === opts.demoToken) {
      req.actorId = 'demo-operator';
      return;
    }

    if (!opts.jwtSecret) {
      reply.code(401).send({ ok: false, error: { code: 'unauthorized', message: 'JWT secret not configured' } });
      return;
    }

    try {
      const payload = jwt.verify(token, opts.jwtSecret) as JwtPayload;
      const sub = payload.sub || payload['user_id'] || payload['email'] || 'unknown';
      req.actorId = String(sub);
    } catch (err) {
      reply.code(401).send({ ok: false, error: { code: 'unauthorized', message: 'Invalid token' } });
    }
  });
};

export default fp(authPlugin, {
  name: 'idea-auth'
});
