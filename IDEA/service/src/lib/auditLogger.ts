import type { Pool } from 'pg';
import { emitAuditEvent } from '../../../../shared/lib/audit';

export async function recordAudit(
  db: Pool,
  actorId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  await emitAuditEvent(db, actorId, eventType, payload, {
    signing: {
      signingProxyUrl: process.env.SIGNING_PROXY_URL,
      kmsKeyId: process.env.KMS_KEY_ID
    }
  });
}
