import fs from 'node:fs';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import { OpenApiValidator } from 'express-openapi-validator';
import YAML from 'js-yaml';
import { randomUUID } from 'node:crypto';
import { KernelDb } from './db';
import { appendAuditEvent, computeDigest } from './audit';
import { createSigningBackend } from './signing';
import { mtlsMiddleware, oidcMiddleware, resolveSecurity } from './security';

const PORT = Number(process.env.PORT || 3000);
const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';

function loadOpenApiSpecPath(): string {
  const specPath = path.resolve(__dirname, '..', '..', 'openapi.yaml');
  if (!fs.existsSync(specPath)) {
    throw new Error(`kernel/openapi.yaml not found at ${specPath}`);
  }
  return specPath;
}

async function createApp(db: KernelDb) {
  const specPath = loadOpenApiSpecPath();
  const signing = createSigningBackend();
  const security = resolveSecurity();

  await signing.checkHealth();

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(mtlsMiddleware(security));
  app.use(oidcMiddleware(security));

  // OpenAPI validator fail-closed
  const spec = YAML.load(fs.readFileSync(specPath, 'utf8'));
  if (!spec) {
    throw new Error('Unable to load OpenAPI spec');
  }
  await new OpenApiValidator({
    apiSpec: specPath,
    validateRequests: true,
    validateResponses: false
  }).install(app);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  app.get('/ready', async (_req, res) => {
    try {
      await db.ready();
      await signing.checkHealth();
      res.json({ status: 'ready' });
    } catch (err: any) {
      res.status(503).json({ error: 'not ready', details: err?.message });
    }
  });

  app.post('/kernel/sign', async (req, res, next) => {
    const { manifest, signerId } = req.body || {};
    if (!manifest || !signerId) {
      return res.status(400).json({ error: 'manifest and signerId are required' });
    }
    try {
      const result = await db.withTransaction(async (client) => {
        const manifestId = manifest.id || randomUUID();
        await client.query(
          `INSERT INTO manifests (id, body, created_at, updated_at)
           VALUES ($1,$2,now(),now())
           ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
          [manifestId, manifest]
        );

        const prevSig = await client.query<{ hash: string }>(
          'SELECT hash FROM manifest_signatures ORDER BY ts DESC LIMIT 1 FOR UPDATE'
        );
        const prevHash = prevSig.rows[0]?.hash ?? null;
        const digest = computeDigest(manifest, prevHash);
        const signed = await signing.signDigest(digest);
        if ((process.env.NODE_ENV || 'development') === 'production' && !signed.signature) {
          throw new Error('Signing backend failed to return signature in production');
        }
        const manifestSignatureId = randomUUID();
        await client.query(
          `INSERT INTO manifest_signatures (id, manifest_id, signer_id, signature, hash, prev_hash, ts)
           VALUES ($1,$2,$3,$4,$5,$6,now())`,
          [manifestSignatureId, manifestId, signerId, signed.signature, digest, prevHash]
        );

        await appendAuditEvent(client, signing, 'manifest.signed', {
          manifestId,
          signerId,
          hash: digest
        });
        return { manifestSignatureId };
      });
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  });

  app.post('/kernel/agent', async (req, res, next) => {
    const { templateId, divisionId, overrides, requester } = req.body || {};
    if (!templateId || !divisionId) {
      return res.status(400).json({ error: 'templateId and divisionId are required' });
    }
    try {
      const result = await db.withTransaction(async (client) => {
        const agentId = randomUUID();
        await client.query(
          `INSERT INTO agents (id, template_id, division_id, overrides, requester, created_at)
           VALUES ($1,$2,$3,$4,$5,now())`,
          [agentId, templateId, divisionId, overrides || {}, requester || null]
        );
        await appendAuditEvent(client, signing, 'agent.spawned', {
          agentId,
          templateId,
          divisionId,
          requester
        });
        return { agentId };
      });
      return res.status(202).json(result);
    } catch (err) {
      return next(err);
    }
  });

  app.get('/kernel/agent/:id', async (req, res, next) => {
    try {
      const result = await db.withTransaction(async (client) => {
        const agent = await client.query(
          'SELECT id, template_id, division_id, overrides, requester, created_at FROM agents WHERE id = $1',
          [req.params.id]
        );
        if (!agent.rows[0]) return null;
        return agent.rows[0];
      });
      if (!result) return res.status(404).json({ error: 'not found' });
      return res.json({
        id: result.id,
        role: result.template_id,
        state: 'created',
        divisionId: result.division_id,
        overrides: result.overrides || {}
      });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/kernel/agent/:id/state', async (req, res, next) => {
    try {
      const data = await db.withTransaction(async (client) => {
        const agent = await client.query(
          'SELECT id, template_id, division_id FROM agents WHERE id = $1',
          [req.params.id]
        );
        const evals = await client.query('SELECT payload FROM eval_reports WHERE agent_id = $1', [
          req.params.id
        ]);
        if (!agent.rows[0]) return null;
        return {
          agent: {
            id: agent.rows[0].id,
            role: agent.rows[0].template_id,
            state: 'created'
          },
          evals: evals.rows.map((r) => r.payload)
        };
      });
      if (!data) return res.status(404).json({ error: 'not found' });
      return res.json(data);
    } catch (err) {
      return next(err);
    }
  });

  app.post('/kernel/division', async (req, res, next) => {
    const manifest = req.body;
    const manifestId = manifest?.id || randomUUID();
    try {
      await db.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO manifests (id, body, created_at, updated_at)
           VALUES ($1,$2,now(),now())
           ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
          [manifestId, manifest]
        );
        await appendAuditEvent(client, signing, 'division.upserted', { manifestId });
      });
      return res.json({ ...manifest, id: manifestId });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/kernel/division/:id', async (req, res, next) => {
    try {
      const manifest = await db.withTransaction(async (client) => {
        const result = await client.query('SELECT body FROM manifests WHERE id = $1', [
          req.params.id
        ]);
        return result.rows[0]?.body || null;
      });
      if (!manifest) return res.status(404).json({ error: 'not found' });
      return res.json(manifest);
    } catch (err) {
      return next(err);
    }
  });

  app.post('/kernel/allocate', async (req, res, next) => {
    const payload = req.body || {};
    try {
      const result = await db.withTransaction(async (client) => {
        const allocationId = randomUUID();
        const divisionId = payload.divisionId || payload.division_id || null;
        const entityId = payload.entityId || payload.entity_id || null;
        await client.query(
          `INSERT INTO allocations (id, division_id, entity_id, payload, created_at)
           VALUES ($1,$2,$3,$4,now())`,
          [allocationId, divisionId, entityId, payload]
        );
        await appendAuditEvent(client, signing, 'allocation.requested', {
          allocationId,
          payload
        });
        return { allocation_id: allocationId };
      });
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  });

  app.post('/kernel/eval', async (req, res, next) => {
    const payload = req.body || {};
    const agentId = payload.agentId || payload.agent_id || null;
    try {
      const result = await db.withTransaction(async (client) => {
        const evalId = randomUUID();
        await client.query(
          `INSERT INTO eval_reports (id, agent_id, payload, created_at)
           VALUES ($1,$2,$3,now())`,
          [evalId, agentId, payload]
        );
        await appendAuditEvent(client, signing, 'eval.submitted', { evalId, agentId });
        return { eval_id: evalId };
      });
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  });

  app.get('/kernel/audit/:id', async (req, res, next) => {
    try {
      const event = await db.withTransaction(async (client) => {
        const result = await client.query(
          'SELECT id, payload, hash, prev_hash, signature FROM audit_events WHERE id = $1',
          [req.params.id]
        );
        return result.rows[0] || null;
      });
      if (!event) return res.status(404).json({ error: 'not found' });
      return res.json({
        id: event.id,
        payload: event.payload,
        hash: event.hash,
        prevHash: event.prev_hash,
        signature: event.signature
      });
    } catch (err) {
      return next(err);
    }
  });

  // error handler for openapi-validator
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || 500;
    const message = err.message || 'unexpected error';
    if (status === 400 || status === 422) {
      return res.status(status).json({ error: message, details: err.errors });
    }
    return res.status(status).json({ error: message });
  });

  return app;
}

async function start() {
  if (!POSTGRES_URL) {
    throw new Error('POSTGRES_URL is required');
  }
  const db = new KernelDb({ connectionString: POSTGRES_URL });
  await db.migrate();
  const app = await createApp(db);
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Kernel server listening on port ${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

export { createApp };
