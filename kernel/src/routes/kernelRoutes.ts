/**
 * kernel/src/routes/kernelRoutes.ts
 *
 * Clean, production-minded Kernel HTTP routes used for local e2e and production.
 *
 * Behavior:
 *  - In NODE_ENV=production endpoints enforce auth/roles per RBAC helpers.
 *  - In non-production the routes relax auth so e2e and local dev run without an auth stack.
 *
 * Acceptance (dev):
 *  - POST /kernel/sign works without auth and returns a signature.
 *  - POST /kernel/division works without auth and upserts a division.
 *  - GET /kernel/division/:id returns division without auth.
 *  - POST /kernel/agent works without auth and returns created agent.
 *  - POST /kernel/eval accepts evals without auth.
 *  - GET /kernel/agent/:id/state returns agent and evals without auth.
 */

import express, { Request, Response, NextFunction, Router, RequestHandler } from 'express';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { getClient, query } from '../db';
import signingProxy from '../signingProxy';
import { appendAuditEvent, getAuditEventById } from '../auditStore';
import { dbRowToDivisionManifest, dbRowToAgentProfile, dbRowToEvalReport } from '../models';
import { DivisionManifest } from '../types';
import {
  requireRoles,
  requireAnyAuthenticated,
  Roles,
  hasRole,
  getPrincipalFromRequest,
  Principal,
  RoleName,
} from '../rbac';
import { enforcePolicyOrThrow, PolicyDecision } from '../sentinelClient';
import idempotencyMiddleware from '../middleware/idempotency';
import {
  handleKernelCreateRequest,
  MissingIdempotencyKeyError,
  IdempotencyKeyConflictError,
} from '../handlers/kernelCreate';
import createUpgradeRouter from './upgradeRoutes';

const ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = ENV === 'production';

function applyProductionGuards(...middlewares: RequestHandler[]): RequestHandler[] {
  return IS_PRODUCTION ? middlewares : [];
}

function requireRolesInProduction(...roles: RoleName[]): RequestHandler[] {
  return applyProductionGuards(requireRoles(...roles));
}

function requireAuthInProduction(): RequestHandler[] {
  return applyProductionGuards(requireAnyAuthenticated);
}

/** Safely serialize JSON-like values for Postgres storage */
function asJsonString(v: any): string | null {
  if (v === undefined || v === null) return null;
  try {
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        JSON.parse(t);
        return t;
      }
    }
    return JSON.stringify(v);
  } catch {
    return JSON.stringify(String(v));
  }
}

async function resolveClient(res: Response): Promise<{ client: PoolClient; managed: boolean }> {
  const ctx = res.locals.idempotency as { client?: PoolClient } | undefined;
  if (ctx?.client) {
    return { client: ctx.client, managed: false };
  }
  const client = await getClient();
  return { client, managed: true };
}

/** Create and return router */
export default function createKernelRouter(): Router {
  const router = express.Router();

  // liveness
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // security info
  router.get('/kernel/security/status', (_req, res) => {
    res.json({
      signer_id: process.env.SIGNER_ID || 'kernel-signer-local',
      public_key: process.env.KMS_ENDPOINT ? `KMS at ${process.env.KMS_ENDPOINT}` : 'local-ephemeral-key (dev-only)',
    });
  });

  router.post(
    '/kernel/create',
    ...requireRolesInProduction(Roles.SUPERADMIN, Roles.OPERATOR),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = ((req as any).principal || getPrincipalFromRequest(req)) as Principal | undefined;

        const result = await handleKernelCreateRequest({
          payload: req.body,
          principal,
          idempotencyKey: req.header('Idempotency-Key'),
        });

        res.setHeader('Idempotency-Key', result.key);
        return res.status(result.status).json(result.response);
      } catch (err) {
        if (err instanceof MissingIdempotencyKeyError) {
          return res.status(400).json({ error: 'missing_idempotency_key' });
        }
        if (err instanceof IdempotencyKeyConflictError) {
          return res.status(409).json({ error: 'idempotency_key_conflict' });
        }
        return next(err);
      }
    },
  );

  router.use('/kernel/upgrade', createUpgradeRouter());

  /**
   * POST /kernel/sign
   */
  router.post(
    '/kernel/sign',
    ...requireAuthInProduction(),
    idempotencyMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      let managed = false;
      let client: PoolClient | undefined;
      try {
        const principal = (req as any).principal || getPrincipalFromRequest(req);

        // In production require authenticated principal and proper role/type
        if (IS_PRODUCTION) {
          if (!principal) return res.status(401).json({ error: 'unauthenticated' });
          if (principal.type !== 'service' && !hasRole(principal, Roles.SUPERADMIN)) {
            return res.status(403).json({ error: 'forbidden' });
          }
        }

        const manifest = req.body.manifest;
        if (!manifest) return res.status(400).json({ error: 'missing manifest in body' });

        // Policy decision (best-effort)
        try {
          const decision = await enforcePolicyOrThrow('manifest.sign', { principal, manifest });
          await appendAuditEvent('policy.decision', { action: 'manifest.sign', manifestId: manifest.id ?? null, decision });
        } catch (polErr) {
          if ((polErr as any).decision) {
            await appendAuditEvent('policy.decision', { action: 'manifest.sign', manifestId: manifest.id ?? null, decision: (polErr as any).decision });
            return res.status(403).json({ error: 'policy.denied', reason: (polErr as any).decision?.reason });
          }
          console.warn('sentinel evaluate failed for manifest.sign, continuing:', (polErr as Error).message || polErr);
        }

        const resolved = await resolveClient(res);
        client = resolved.client;
        managed = resolved.managed;
        if (managed) {
          await client.query('BEGIN');
        }

        const sig = await signingProxy.signManifest(manifest);

        try {
          await client.query(
            `INSERT INTO manifest_signatures (id, manifest_id, signer_id, signature, version, ts, prev_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              sig.id,
              sig.manifestId ?? null,
              sig.signerId ?? null,
              sig.signature,
              sig.version ?? null,
              sig.ts ?? new Date().toISOString(),
              (sig as any).prevHash ?? null,
            ],
          );
        } catch (e) {
          console.warn('persist manifest_signature failed:', (e as Error).message || e);
        }

        try {
          await appendAuditEvent('manifest.signed', { manifestId: sig.manifestId ?? null, signatureId: sig.id, signerId: sig.signerId ?? null, principal });
        } catch (e) {
          console.warn('audit append failed for manifest.signed:', (e as Error).message || e);
        }

        if (managed) {
          await client.query('COMMIT');
          client.release();
          client = undefined;
        }

        return res.json({
          manifest_id: sig.manifestId ?? null,
          signer_id: sig.signerId ?? null,
          signature: sig.signature,
          version: sig.version,
          ts: sig.ts,
        });
      } catch (err) {
        if (managed && client) {
          await client.query('ROLLBACK').catch(() => {});
          client.release();
        }
        return next(err);
    }
    },
  );

  /**
   * POST /kernel/division - upsert
   * Prod: require DivisionLead|SuperAdmin. Dev: allow.
   */
  router.post(
    '/kernel/division',
    ...requireRolesInProduction(Roles.SUPERADMIN, Roles.DIVISION_LEAD),
    idempotencyMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      const manifest: DivisionManifest = req.body;
      if (!manifest || !manifest.id) return res.status(400).json({ error: 'manifest with id required' });

      const principal = (req as any).principal || getPrincipalFromRequest(req);

    let managed = false;
    let client: PoolClient | undefined;
    try {
      // Policy
      try {
        const decision: PolicyDecision = await enforcePolicyOrThrow('manifest.update', { principal, manifest });
        await appendAuditEvent('policy.decision', { action: 'manifest.update', manifestId: manifest.id, decision });
      } catch (err) {
        if ((err as any).decision?.allowed === false) {
          await appendAuditEvent('policy.decision', { action: 'manifest.update', manifestId: manifest.id, decision: (err as any).decision });
          return res.status(403).json({ error: 'policy.denied', reason: (err as any).decision?.reason });
        }
        console.warn('sentinel evaluate failed for manifest.update, continuing:', (err as Error).message || err);
      }

      const resolved = await resolveClient(res);
      client = resolved.client;
      managed = resolved.managed;
      if (managed) {
        await client.query('BEGIN');
      }

      const sig = await signingProxy.signManifest(manifest);

      await client.query(
        `INSERT INTO manifest_signatures (id, manifest_id, signer_id, signature, version, ts, prev_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          sig.id,
          manifest.id,
          sig.signerId ?? null,
          sig.signature,
          sig.version ?? manifest.version ?? null,
          sig.ts ?? new Date().toISOString(),
          (sig as any).prevHash ?? null,
        ],
      );

      const upsert = `
        INSERT INTO divisions (
          id, name, goals, budget, currency, kpis, policies, metadata, status, version, manifest_signature_id, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          goals = EXCLUDED.goals,
          budget = EXCLUDED.budget,
          currency = EXCLUDED.currency,
          kpis = EXCLUDED.kpis,
          policies = EXCLUDED.policies,
          metadata = EXCLUDED.metadata,
          status = EXCLUDED.status,
          version = EXCLUDED.version,
          manifest_signature_id = EXCLUDED.manifest_signature_id,
          updated_at = now()
      `;
      await client.query(upsert, [
        manifest.id,
        manifest.name ?? null,
        asJsonString(manifest.goals ?? []),
        manifest.budget ?? 0,
        manifest.currency ?? 'USD',
        asJsonString(manifest.kpis ?? []),
        asJsonString(manifest.policies ?? []),
        asJsonString(manifest.metadata ?? {}),
        manifest.status ?? 'active',
        manifest.version ?? '1.0.0',
        sig.id,
      ]);

      if (managed) {
        await client.query('COMMIT');
        client.release();
        client = undefined;
      }

      try {
        await appendAuditEvent('manifest.update', { manifestId: manifest.id, signatureId: sig.id, signerId: sig.signerId ?? null, principal });
      } catch (e) {
        console.warn('Audit append failed for manifest.update:', (e as Error).message || e);
      }

      return res.json(manifest);
    } catch (err) {
      if (managed && client) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
      return next(err);
    }
    },
  );

  /**
   * GET /kernel/division/:id
   * Prod: require principal. Dev: allow.
   */
  router.get(
    '/kernel/division/:id',
    ...requireAuthInProduction(),
    async (req: Request, res: Response, next: NextFunction) => {
      const id = req.params.id;

      try {
        const r = await query(
          `SELECT id, name, goals, budget, currency, kpis, policies, metadata, status, version, manifest_signature_id, created_at, updated_at
         FROM divisions WHERE id = $1`,
          [id],
        );
        if (!r.rows.length) return res.status(404).json({ error: 'not found' });
        return res.json(dbRowToDivisionManifest(r.rows[0]));
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * POST /kernel/agent
   * Prod: require Operator|SuperAdmin. Dev: allow.
   */
  router.post(
    '/kernel/agent',
    ...requireRolesInProduction(Roles.SUPERADMIN, Roles.OPERATOR),
    idempotencyMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      const body = req.body;
      if (!body) return res.status(400).json({ error: 'body required' });

      const principal = (req as any).principal || getPrincipalFromRequest(req);

      const id = body.id || `agent-${crypto.randomUUID()}`;
      let managed = false;
      let client: PoolClient | undefined;
      try {
        const resolved = await resolveClient(res);
        client = resolved.client;
        managed = resolved.managed;
        if (managed) {
          await client.query('BEGIN');
        }

        await client.query(
          `INSERT INTO agents (id, template_id, role, skills, code_ref, division_id, state, score, resource_allocation, last_heartbeat, owner, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10, now(), now())
           ON CONFLICT (id) DO NOTHING`,
          [
            id,
            body.templateId || null,
            body.role || null,
            asJsonString(body.skills ?? []),
            body.codeRef || null,
            body.divisionId || null,
            'running',
            body.computedScore ?? 0.0,
            asJsonString(body.resourceAllocation ?? {}),
            body.owner || null,
          ],
        );

        await appendAuditEvent('agent.spawn', { agentId: id, templateId: body.templateId || null, principal });

        const createdRes = await client.query('SELECT * FROM agents WHERE id = $1', [id]);

        const payload = createdRes.rows[0]
          ? dbRowToAgentProfile(createdRes.rows[0])
          : { id, role: body.role, skills: body.skills };

        if (managed) {
          await client.query('COMMIT');
          client.release();
          client = undefined;
        }

        return res.status(201).json(payload);
      } catch (err) {
        if (managed && client) {
          await client.query('ROLLBACK').catch(() => {});
          client.release();
        }
        return next(err);
    }
    },
  );

  /**
   * GET /kernel/agent/:id/state
   * Prod: require auth; Dev: allow.
   */
  router.get(
    '/kernel/agent/:id/state',
    ...requireAuthInProduction(),
    async (req: Request, res: Response, next: NextFunction) => {
      const id = req.params.id;

      try {
        const r = await query('SELECT * FROM agents WHERE id = $1', [id]);
        if (!r.rows.length) return res.status(404).json({ error: 'not found' });
        const agent = dbRowToAgentProfile(r.rows[0]);
        const evalsRes = await query('SELECT * FROM eval_reports WHERE agent_id = $1 ORDER BY timestamp DESC LIMIT 10', [id]);
        const evals = evalsRes.rows.map(dbRowToEvalReport);
        return res.json({ agent, evals });
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * POST /kernel/eval
   * Prod: require auth; Dev: allow.
   */
  router.post(
    '/kernel/eval',
    ...requireAuthInProduction(),
    idempotencyMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      const body = req.body;
      if (!body || !body.agent_id) return res.status(400).json({ error: 'agent_id required' });

      const principal = (req as any).principal || getPrincipalFromRequest(req);

      let managed = false;
      let client: PoolClient | undefined;
      try {
      const id = body.id || `eval-${crypto.randomUUID()}`;
      const resolved = await resolveClient(res);
      client = resolved.client;
      managed = resolved.managed;
      if (managed) {
        await client.query('BEGIN');
      }

      await client.query(
        'INSERT INTO eval_reports (id, agent_id, metric_set, timestamp, source, computed_score, "window") VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          body.agent_id,
          asJsonString(body.metric_set || {}),
          body.timestamp || new Date().toISOString(),
          body.source || 'unknown',
          body.computedScore ?? null,
          body.window ?? null,
        ],
      );

      if (body.computedScore != null) {
        try {
          await client.query('UPDATE agents SET score = $1, updated_at = now() WHERE id = $2', [body.computedScore, body.agent_id]);
        } catch (e) {
          console.warn('Agent score update failed:', (e as Error).message || e);
        }
      }

      await appendAuditEvent('eval.submitted', { evalId: id, agentId: body.agent_id, principal });

      if (managed) {
        await client.query('COMMIT');
        client.release();
        client = undefined;
      }

      return res.json({ ok: true, eval_id: id });
    } catch (err) {
        if (managed && client) {
          await client.query('ROLLBACK').catch(() => {});
          client.release();
        }
        return next(err);
    }
    },
  );

  /**
   * POST /kernel/allocate
   * Prod: require Operator|DivisionLead|SuperAdmin. Dev: allow.
   */
  router.post(
    '/kernel/allocate',
    ...requireRolesInProduction(Roles.SUPERADMIN, Roles.DIVISION_LEAD, Roles.OPERATOR),
    idempotencyMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      const body = req.body;
      if (!body || !body.entity_id) return res.status(400).json({ error: 'entity_id required' });

      const principal = (req as any).principal || getPrincipalFromRequest(req);

      let managed = false;
      let client: PoolClient | undefined;
      try {
        try {
          const decision = await enforcePolicyOrThrow('allocation.request', { principal, allocation: body });
          await appendAuditEvent('policy.decision', { action: 'allocation.request', allocation: { entityId: body.entity_id, delta: body.delta }, decision });
        } catch (polErr) {
          if ((polErr as any).decision?.allowed === false) {
            await appendAuditEvent('policy.decision', { action: 'allocation.request', allocation: { entityId: body.entity_id, delta: body.delta }, decision: (polErr as any).decision });
            return res.status(403).json({ error: 'policy.denied', reason: (polErr as any).decision?.reason });
          }
          console.warn('sentinel evaluate failed for allocation.request, continuing:', (polErr as Error).message || polErr);
        }

        const id = `alloc-${crypto.randomUUID()}`;
        const resolved = await resolveClient(res);
        client = resolved.client;
        managed = resolved.managed;
        if (managed) {
          await client.query('BEGIN');
        }

        await client.query('INSERT INTO resource_allocations (id, entity_id, pool, delta, reason, requested_by, status, ts) VALUES ($1,$2,$3,$4,$5,$6,$7,now())', [
          id,
          body.entity_id,
          body.pool || null,
          body.delta || 0,
          body.reason || null,
          body.requestedBy || 'system',
          body.status || 'pending',
        ]);

        await appendAuditEvent('allocation.request', { allocationId: id, entityId: body.entity_id, delta: body.delta, principal });

        if (managed) {
          await client.query('COMMIT');
          client.release();
          client = undefined;
        }

        return res.json({ ok: true, allocation: { id } });
      } catch (err) {
        if (managed && client) {
          await client.query('ROLLBACK').catch(() => {});
          client.release();
        }
        return next(err);
    }
    },
  );

  /**
   * GET /kernel/audit/:id
   * Prod: require Auditor|SuperAdmin. Dev: allow.
   */
  router.get(
    '/kernel/audit/:id',
    ...requireRolesInProduction(Roles.SUPERADMIN, Roles.AUDITOR),
    async (req: Request, res: Response, next: NextFunction) => {
      const id = req.params.id;

      try {
        const ev = await getAuditEventById(id);
        if (!ev) return res.status(404).json({ error: 'not found' });
        return res.json(ev);
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * GET /kernel/reason/:node (stub)
   */
  router.get(
    '/kernel/reason/:node',
    ...requireAuthInProduction(),
    async (req: Request, res: Response) => {
      const node = req.params.node;
      return res.json({
        node,
        trace: [{ step: 1, ts: new Date().toISOString(), note: 'trace stub — integrate with reasoning-graph' }],
      });
    },
  );

  return router;
}

/*
 Minimal acceptance checklist (dev):
 - POST /kernel/sign returns signature without auth.
 - POST /kernel/division upserts division without auth.
 - GET /kernel/division/:id returns division without auth.
 - POST /kernel/agent spawns agent without auth.
 - POST /kernel/eval accepts evals without auth.
 - GET /kernel/agent/:id/state returns agent and evals without auth.
*/

