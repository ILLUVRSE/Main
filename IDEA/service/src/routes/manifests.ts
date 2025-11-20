import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';
import { recordAudit } from '../lib/auditLogger';
import { submitManifestForSigning } from '../lib/kernelClient';

const createSchema = z.object({
  package_id: z.string().uuid(),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('LOW'),
  preconditions: z.record(z.any()),
  description: z.string().optional()
});

const submitSchema = z.object({
  payload: z.record(z.any()).optional()
});

const multisigSchema = z.object({
  approvals_required: z.number().int().positive(),
  approvers: z.array(z.string()).min(1)
});

const approvalSchema = z.object({
  approver_id: z.string().min(3),
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().optional()
});

export default async function manifestRoutes(app: FastifyInstance) {
  app.post('/manifests/create', async (req, reply) => {
    const actor = req.actorId || 'unknown';
    const body = createSchema.parse(req.body ?? {});
    const pkgRes = await pool.query('SELECT id, status FROM idea_packages WHERE id = $1', [body.package_id]);
    if (!pkgRes.rowCount) {
      reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'package not found' } });
      return;
    }
    const id = uuidv4();
    await pool.query(
      `INSERT INTO idea_manifests (id, package_id, status, impact, preconditions)
       VALUES ($1,$2,'draft',$3,$4)`,
      [id, body.package_id, body.impact, body.preconditions]
    );

    await recordAudit(pool, actor, 'idea.manifest.created', {
      manifest_id: id,
      package_id: body.package_id,
      impact: body.impact
    });

    reply.send({ ok: true, manifest_id: id });
  });

  app.post('/manifests/:id/submit-for-signing', async (req, reply) => {
    const actor = req.actorId || 'unknown';
    const { id } = req.params as { id: string };
    const body = submitSchema.parse(req.body ?? {});
    const manifestRes = await pool.query(
      `SELECT m.id, m.status, m.preconditions, m.package_id, p.sha256, p.package_name, p.version
         FROM idea_manifests m
         JOIN idea_packages p ON p.id = m.package_id
        WHERE m.id = $1`,
      [id]
    );
    if (!manifestRes.rowCount) {
      reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'manifest not found' } });
      return;
    }
    const manifest = manifestRes.rows[0];
    if (manifest.status !== 'draft') {
      reply.code(409).send({ ok: false, error: { code: 'invalid_state', message: 'manifest not draft' } });
      return;
    }
    if (!manifest.sha256) {
      reply.code(412).send({ ok: false, error: { code: 'package_incomplete', message: 'package sha256 missing' } });
      return;
    }

    const payload = body.payload || {
      package_id: manifest.package_id,
      sha256: manifest.sha256,
      package_name: manifest.package_name,
      version: manifest.version,
      preconditions: manifest.preconditions
    };

    const kernelResp = await submitManifestForSigning(id, payload);
    await pool.query(
      `UPDATE idea_manifests
          SET status = 'signed',
              manifest_signature_id = $2,
              kernel_response = $3,
              signed_payload = $4,
              updated_at = now()
        WHERE id = $1`,
      [id, kernelResp.manifest_signature_id, kernelResp, payload]
    );

    await recordAudit(pool, actor, 'idea.manifest.signed', {
      manifest_id: id,
      manifest_signature_id: kernelResp.manifest_signature_id,
      signer_kid: kernelResp.signer_kid
    });

    reply.send({ ok: true, manifest_id: id, manifest_signature_id: kernelResp.manifest_signature_id });
  });

  app.post('/manifests/:id/request-multisig', async (req, reply) => {
    const actor = req.actorId || 'unknown';
    const { id } = req.params as { id: string };
    const body = multisigSchema.parse(req.body ?? {});
    const manifestRes = await pool.query(
      'SELECT id, status FROM idea_manifests WHERE id = $1',
      [id]
    );
    if (!manifestRes.rowCount) {
      reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'manifest not found' } });
      return;
    }
    const manifest = manifestRes.rows[0];
    if (manifest.status !== 'signed') {
      reply.code(409).send({ ok: false, error: { code: 'invalid_state', message: 'manifest must be signed' } });
      return;
    }

    await pool.query(
      `UPDATE idea_manifests
          SET status = 'awaiting_multisig',
              multisig_required = $2,
              multisig_threshold = $2,
              updated_at = now()
        WHERE id = $1`,
      [id, body.approvals_required]
    );

    await recordAudit(pool, actor, 'idea.manifest.multisig_requested', {
      manifest_id: id,
      approvals_required: body.approvals_required,
      approvers: body.approvers
    });

    reply.send({
      ok: true,
      manifest_id: id,
      approvals_required: body.approvals_required
    });
  });

  app.post('/manifests/:id/approvals', async (req, reply) => {
    const actor = req.actorId || 'unknown';
    const { id } = req.params as { id: string };
    const body = approvalSchema.parse(req.body ?? {});
    const manifestRes = await pool.query(
      'SELECT id, status, multisig_threshold FROM idea_manifests WHERE id = $1',
      [id]
    );
    if (!manifestRes.rowCount) {
      reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'manifest not found' } });
      return;
    }
    const manifest = manifestRes.rows[0];
    if (!['awaiting_multisig', 'multisig_partial'].includes(manifest.status)) {
      reply.code(409).send({ ok: false, error: { code: 'invalid_state', message: 'manifest not awaiting multisig' } });
      return;
    }
    const approvalId = uuidv4();
    await pool.query(
      `INSERT INTO idea_manifest_approvals (id, manifest_id, approver_id, decision, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [approvalId, id, body.approver_id, body.decision, body.notes ?? null]
    );

    const { rows } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE decision = 'approved')::int AS approvals
         FROM idea_manifest_approvals
        WHERE manifest_id = $1`,
      [id]
    );
    const approvals = rows[0]?.approvals ?? 0;
    const nextStatus = approvals >= manifest.multisig_threshold ? 'multisig_complete' : 'multisig_partial';
    await pool.query('UPDATE idea_manifests SET status = $2, updated_at = now() WHERE id = $1', [id, nextStatus]);

    await recordAudit(pool, actor, 'idea.manifest.approval_recorded', {
      manifest_id: id,
      approver_id: body.approver_id,
      decision: body.decision,
      approvals_obtained: approvals
    });

    reply.send({ ok: true, manifest_id: id, approvals_obtained: approvals, status: nextStatus });
  });

  app.post('/manifests/:id/apply', async (req, reply) => {
    const actor = req.actorId || 'unknown';
    const { id } = req.params as { id: string };
    const manifestRes = await pool.query(
      `SELECT id, status, manifest_signature_id, multisig_threshold
         FROM idea_manifests WHERE id = $1`,
      [id]
    );
    if (!manifestRes.rowCount) {
      reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'manifest not found' } });
      return;
    }
    const manifest = manifestRes.rows[0];
    if (manifest.status !== 'multisig_complete' && manifest.status !== 'signed') {
      reply.code(409).send({ ok: false, error: { code: 'invalid_state', message: 'manifest not ready for apply' } });
      return;
    }
    if (!manifest.manifest_signature_id) {
      reply.code(400).send({ ok: false, error: { code: 'missing_signature', message: 'manifest not signed' } });
      return;
    }

    await pool.query(
      `UPDATE idea_manifests
          SET status = 'applied',
              applied_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [id]
    );

    await recordAudit(pool, actor, 'idea.manifest.applied', {
      manifest_id: id,
      manifest_signature_id: manifest.manifest_signature_id
    });

    await notifyDownstream(id);

    reply.send({ ok: true, manifest_id: id, status: 'applied' });
  });
}

async function notifyDownstream(manifestId: string) {
  const tasks: Promise<unknown>[] = [];
  if (process.env.REPOWRITER_URL) {
    tasks.push(postJson(process.env.REPOWRITER_URL + '/manifests/apply', { manifest_id: manifestId }));
  }
  if (process.env.MARKETPLACE_API_URL) {
    tasks.push(postJson(process.env.MARKETPLACE_API_URL + '/internal/manifests/apply', { manifest_id: manifestId }));
  }
  await Promise.allSettled(tasks);
}

async function postJson(url: string, body: Record<string, unknown>) {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}
