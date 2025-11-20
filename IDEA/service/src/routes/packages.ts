import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';
import { presignPackageUpload, sha256FromS3 } from '../lib/s3';
import { recordAudit } from '../lib/auditLogger';

const submitSchema = z.object({
  package_name: z.string().min(1),
  version: z.string().min(1),
  notes: z.string().optional(),
  metadata: z.record(z.any()).default({})
});

const completeSchema = z.object({
  s3_key: z.string().optional(),
  expected_sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional()
});

export default async function packagesRoutes(app: FastifyInstance) {
  app.post('/packages/submit', async (request, reply) => {
    const actorId = request.actorId || 'unknown';
    const body = submitSchema.parse(request.body ?? {});
    const id = uuidv4();
    const s3Key = `packages/${id}/artifact.tgz`;
    const uploadUrl = await presignPackageUpload(s3Key);

    const result = await pool.query(
      `INSERT INTO idea_packages (id, package_name, version, status, created_by, metadata, notes, s3_key, upload_url)
       VALUES ($1,$2,$3,'submitted',$4,$5,$6,$7,$8)
       RETURNING id, package_name, version, status, created_by, metadata, s3_key, upload_url, created_at`,
      [id, body.package_name, body.version, actorId, body.metadata, body.notes ?? null, s3Key, uploadUrl]
    );

    await recordAudit(pool, `${actorId}`, 'idea.package.submitted', {
      package_id: id,
      package_name: body.package_name,
      version: body.version
    });

    reply.send({
      ok: true,
      package: result.rows[0],
      upload: {
        url: uploadUrl,
        method: 'PUT',
        expires_in: 900,
        bucket_key: s3Key
      }
    });
  });

  app.post('/packages/:id/complete', async (request, reply) => {
    const actorId = request.actorId || 'unknown';
    const { id } = request.params as { id: string };
    const body = completeSchema.parse(request.body ?? {});

    const pkgRes = await pool.query(
      'SELECT id, s3_key, status FROM idea_packages WHERE id = $1',
      [id]
    );
    if (!pkgRes.rowCount) {
      reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'package not found' } });
      return;
    }

    const s3Key = body.s3_key || pkgRes.rows[0].s3_key;
    if (!s3Key) {
      reply.code(400).send({ ok: false, error: { code: 'invalid_state', message: 's3_key missing' } });
      return;
    }

    const { sha256, size } = await sha256FromS3(s3Key);
    if (body.expected_sha256 && body.expected_sha256.toLowerCase() !== sha256) {
      reply.code(409).send({
        ok: false,
        error: { code: 'sha256_mismatch', message: 'sha256 mismatch', details: { expected: body.expected_sha256, actual: sha256 } }
      });
      return;
    }

    await pool.query(
      `UPDATE idea_packages
         SET status = 'completed',
             sha256 = $2,
             size_bytes = $3,
             s3_key = $4,
             updated_at = now()
       WHERE id = $1`,
      [id, sha256, size, s3Key]
    );

    await recordAudit(pool, actorId, 'idea.package.completed', {
      package_id: id,
      sha256,
      size
    });

    reply.send({
      ok: true,
      package_id: id,
      sha256,
      size_bytes: size
    });
  });
}
