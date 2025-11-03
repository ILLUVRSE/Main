/**
 * kernel/src/routes/kernelRoutes.ts
 *
 * Express Router that implements the Kernel HTTP contract.
 *
 * Updated: ensure JSON/array fields are safely serialized when inserting/updating
 * into Postgres to avoid "invalid input syntax for type json" errors.
 * Always JSON.stringify JSON/JSONB columns to avoid passing plain strings that
 * are not valid JSON (common when clients send malformed values).
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import crypto from 'crypto';
import { getClient, query } from '../db';
import signingProxy from '../signingProxy';
import { appendAuditEvent, getAuditEventById } from '../auditStore';
import {
  dbRowToDivisionManifest,
  dbRowToAgentProfile,
  dbRowToEvalReport,
  dbRowToAuditEvent,
} from '../models';
import { DivisionManifest } from '../types';

const KMS_SIGNER_ID = process.env.SIGNER_ID || 'kernel-signer-local';

function safeJson(v: any): any {
  if (v === undefined) return null;
  try {
    if (v === null) return null;
    if (typeof v === 'object') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    const trimmed = String(v).trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return JSON.parse(trimmed);
    }
    return v;
  } catch (e) {
    return v;
  }
}

function asJsonString(v: any): string | null {
  const val = safeJson(v);
  if (val === null || val === undefined) return null;
  try {
    return JSON.stringify(val);
  } catch (e) {
    // fallback: stringify the string representation
    return JSON.stringify(String(val));
  }
}

export default function createKernelRouter(): Router {
  const router = express.Router();

  // Health (optionally mountable)
  router.get('/health', (_req, res) => {
    return res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // Security status
  router.get('/kernel/security/status', (_req, res) => {
    return res.json({
      signer_id: KMS_SIGNER_ID,
      public_key: process.env.KMS_ENDPOINT ? `KMS at ${process.env.KMS_ENDPOINT}` : 'local-ephemeral-key (dev-only)',
    });
  });

  // POST /kernel/sign
  router.post('/kernel/sign', async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const manifest = req.body.manifest;
      if (!manifest) return res.status(400).json({ error: 'missing manifest in body' });

      const sig = await signingProxy.signManifest(manifest);

      // Persist manifest signature (best-effort)
      try {
        await query(
          `INSERT INTO manifest_signatures (id, manifest_id, signer_id, signature, version, ts, prev_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [sig.id, sig.manifestId ?? null, sig.signerId ?? null, sig.signature, sig.version ?? null, sig.ts ?? new Date().toISOString(), (sig as any).prevHash ?? null],
        );
      } catch (err) {
        console.warn('persist manifest_signature failed (table missing?):', (err as Error).message || err);
      }

      // Emit audit event (best-effort)
      try {
        await appendAuditEvent('manifest.signed', { manifestId: sig.manifestId ?? null, signatureId: sig.id, signerId: sig.signerId ?? null });
      } catch (err) {
        console.warn('audit append failed for manifest.signed:', (err as Error).message || err);
      }

      return res.json({
        manifest_id: sig.manifestId ?? null,
        signer_id: sig.signerId ?? null,
        signature: sig.signature,
        version: sig.version,
        ts: sig.ts,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /kernel/division
  router.post('/kernel/division', async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const manifest: DivisionManifest = req.body;
    if (!manifest || !manifest.id) return res.status(400).json({ error: 'manifest with id required' });

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const sig = await signingProxy.signManifest(manifest);

      await client.query(
        `INSERT INTO manifest_signatures (id, manifest_id, signer_id, signature, version, ts, prev_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sig.id, manifest.id, sig.signerId ?? null, sig.signature, sig.version ?? manifest.version ?? null, sig.ts ?? new Date().toISOString(), (sig as any).prevHash ?? null],
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

      // Always pass JSON/JSONB columns as JSON strings to avoid invalid-input errors.
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

      await client.query('COMMIT');

      try {
        await appendAuditEvent('manifest.update', { manifestId: manifest.id, signatureId: sig.id, signerId: sig.signerId ?? null });
      } catch (e) {
        console.warn('Audit append failed for manifest.update:', (e as Error).message || e);
      }

      return res.json(manifest);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  });

  // GET /kernel/division/:id
  router.get('/kernel/division/:id', async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = req.params.id;
    try {
      const r = await query('SELECT id, name, goals, budget, currency, kpis, policies, metadata, status, version, manifest_signature_id, created_at, updated_at FROM divisions WHERE id = $1', [id]);
      if (!r.rows.length) return res.status(404).json({ error: 'not found' });
      const division = dbRowToDivisionManifest(r.rows[0]);
      return res.json(division);
    } catch (err) {
      next(err);
    }
  });

  // POST /kernel/agent
  router.post('/kernel/agent', async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const body = req.body;
    if (!body) return res.status(400).json({ error: 'body required' });
    const id = body.id || `agent-${crypto.randomUUID()}`;
    try {
      await query(
        `INSERT INTO agents (id, template_id, role, skills, code_ref, division_id, state, score, resource_allocation, last_heartbeat, owner, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [id, body.templateId || null, body.role || null, asJsonString(body.skills ?? []), body.codeRef || null, body.divisionId || null, 'running', 0.0, asJsonString(body.resourceAllocation || {}), body.owner || null],
      );
      await appendAuditEvent('agent.spawn', { agentId: id, templateId: body.templateId || null });
      const createdRes = await query('SELECT * FROM agents WHERE id = $1', [id]);
      const created = createdRes.rows[0] ? dbRowToAgentProfile(createdRes.rows[0]) : null;
      return res.status(201).json(created ?? { id, role: body.role, skills: body.skills });
    } catch (err) {
      next(err);
    }
  });

  // GET /kernel/agent/:id/state
  router.get('/kernel/agent/:id/state', async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = req.params.id;
    try {
      const r = await query('SELECT * FROM agents WHERE id = $1', [id]);
      if (!r.rows.length) return res.status(404).json({ error: 'not found' });
      const agent = dbRowToAgentProfile(r.rows[0]);
      const evalsRes = await query('SELECT * FROM eval_reports WHERE agent_id = $1 ORDER BY timestamp DESC LIMIT 10', [id]);
      const evals = evalsRes.rows.map(dbRowToEvalReport);
      return res.json({ agent, evals });
    } catch (err) {
      next(err);
    }
  });

  // POST /kernel/eval
  router.post('/kernel/eval', async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const body = req.body;
    if (!body || !body.agent_id) return res.status(400).json({ error: 'agent_id required' });
    try {
      const id = body.id || `eval-${crypto.randomUUID()}`;
      await query('INSERT INTO eval_reports (id, agent_id, metric_set, timestamp, source, computed_score, "window") VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, body.agent_id, asJsonString(body.metric_set || {}), body.timestamp || new Date().toISOString(), body.source || 'unknown', body.computedScore || null, body.window || null]);
      if (body.computedScore != null) {
        try {
          await query('UPDATE agents SET score = $1, updated_at = now() WHERE id = $2', [body.computedScore, body.agent_id]);
        } catch (e) {
          console.warn('Agent score update failed:', (e as Error).message || e);
        }
      }
      await appendAuditEvent('eval.submitted', { evalId: id, agentId: body.agent_id });
      return res.json({ ok: true, eval_id: id });
    } catch (err) {
      next(err);
    }
  });

  // POST /kernel/allocate
  router.post('/kernel/allocate', async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const body = req.body;
    if (!body || !body.entity_id) return res.status(400).json({ error: 'entity_id required' });
    try {
      const id = `alloc-${crypto.randomUUID()}`;
      await query('INSERT INTO resource_allocations (id, entity_id, pool, delta, reason, requested_by, status, ts) VALUES ($1,$2,$3,$4,$5,$6,$7,now())',
        [id, body.entity_id, body.pool || null, body.delta || 0, body.reason || null, body.requestedBy || 'system', body.status || 'pending']);
      await appendAuditEvent('allocation.request', { allocationId: id, entityId: body.entity_id, delta: body.delta });
      return res.json({ ok: true, allocation: { id } });
    } catch (err) {
      next(err);
    }
  });

  // GET /kernel/audit/:id
  router.get('/kernel/audit/:id', async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = req.params.id;
    try {
      const ev = await getAuditEventById(id);
      if (!ev) return res.status(404).json({ error: 'not found' });
      return res.json(ev);
    } catch (err) {
      next(err);
    }
  });

  // GET /kernel/reason/:node (stub)
  router.get('/kernel/reason/:node', (_req, res) => {
    const node = _req.params.node;
    return res.json({
      node,
      trace: [
        { step: 1, ts: new Date().toISOString(), note: 'trace stub — integrate with reasoning-graph' },
      ],
    });
  });

  return router;
}

/**
 * Acceptance criteria (short, testable):
 *
 * - Division upsert serializes JSON/array fields safely so Postgres JSON/JSONB columns accept them.
 *   Test: POST /kernel/division with arrays/objects and ensure HTTP 200 and row present in DB.
 *
 * - Existing behavior unchanged for other endpoints.
 */

