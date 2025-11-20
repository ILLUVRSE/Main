import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';
import { recordAudit } from '../lib/auditLogger';

const publishSchema = z.object({
  manifest_id: z.string().uuid(),
  mode: z.enum(['buyer-managed', 'marketplace-managed']),
  artifact_url: z.string().url(),
  delivery_proof: z.record(z.any()),
  key_metadata: z.record(z.any()).optional()
});

export default async function publishRoutes(app: FastifyInstance) {
  app.post('/publish/notify', async (req, reply) => {
    const actor = req.actorId || 'unknown';
    const body = publishSchema.parse(req.body ?? {});
    const manifestRes = await pool.query('SELECT id FROM idea_manifests WHERE id = $1', [body.manifest_id]);
    if (!manifestRes.rowCount) {
      reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'manifest not found' } });
      return;
    }

    const eventId = uuidv4();
    await pool.query(
      `INSERT INTO idea_publish_events (id, manifest_id, payload)
       VALUES ($1,$2,$3)`,
      [eventId, body.manifest_id, body]
    );

    await recordAudit(pool, actor, 'idea.publish.completed', {
      manifest_id: body.manifest_id,
      mode: body.mode,
      delivery_proof_ref: eventId
    });

    reply.send({ ok: true, publish_event_id: eventId });
  });
}
