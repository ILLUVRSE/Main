import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// In-memory session store for dev/local; real impl should persist sessions in DB
type PreviewSession = {
  session_id: string;
  sku_id: string;
  endpoint: string;
  expires_at: string; // ISO
  started_at: string;
  status: 'running' | 'expired' | 'failed' | 'completed';
  metadata?: any;
};

const sessions = new Map<string, PreviewSession>();

function addSecondsToDate(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function toIso(date: Date | string) {
  if (typeof date === 'string') return date;
  return date.toISOString();
}

/**
 * Helper: attempt to append an audit event if auditWriter exists.
 * AuditEvent shape (minimum):
 * {
 *   actor_id, event_type, payload, hash, prev_hash, signature?, signer_kid?, created_at
 * }
 */
async function emitAuditEvent(eventType: string, actorId: string | undefined, payload: any) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const auditMod = require('../lib/auditWriter');
    const auditWriter = auditMod && (auditMod.default || auditMod);
    if (auditWriter && typeof auditWriter.appendAuditEvent === 'function') {
      // Minimal event
      const evt = {
        actor_id: actorId || 'anon',
        event_type: eventType,
        payload,
        created_at: new Date().toISOString(),
      };
      await auditWriter.appendAuditEvent(evt);
    }
  } catch (e) {
    // audit writer not implemented or failed; ignore for dev
    // eslint-disable-next-line no-console
    console.debug('auditWriter not available or failed:', (e as Error).message);
  }
}

/**
 * Helper: start a sandbox runner if implemented; otherwise return a fallback endpoint.
 * The sandbox runner (if present) is expected to expose `runSandbox(opts)` that returns an object:
 * { session_id, endpoint, started_at, expires_at, status }
 */
async function startSandbox(skuId: string, ttlSeconds: number, sessionMetadata: any, requestId?: string) {
  // Try to require an implemented sandbox runner
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runnerMod = require('../../sandbox/sandboxRunner');
    const runner = runnerMod && (runnerMod.default || runnerMod);
    if (runner && typeof runner.runSandbox === 'function') {
      const opts = {
        skuId,
        ttlSeconds,
        sessionMetadata,
        requestId,
      };
      const res = await runner.runSandbox(opts);
      // Expect runner returns session_id, endpoint, started_at, expires_at, status
      return {
        session_id: res.session_id || `preview-${uuidv4()}`,
        endpoint: res.endpoint || `wss://sandbox.example.com/sessions/${res.session_id || uuidv4()}`,
        started_at: res.started_at || new Date().toISOString(),
        expires_at: res.expires_at || formatISO(addSeconds(new Date(), ttlSeconds)),
        status: res.status || 'running',
      };
    }
  } catch (err) {
    // runner not implemented — fall back
    // eslint-disable-next-line no-console
    console.debug('Sandbox runner not available:', (err as Error).message);
  }

  // Fallback stub: return a short-lived wss endpoint and record in-memory session
  const sessionId = `preview-${uuidv4()}`;
  const now = new Date();
  const expires = addSeconds(now, ttlSeconds);
  const endpoint = `wss://sandbox.local/sessions/${sessionId}`;
  return {
    session_id: sessionId,
    endpoint,
    started_at: now.toISOString(),
    expires_at: formatISO(expires),
    status: 'running',
  };
}

/**
 * POST /sku/:sku_id/preview
 * Body:
 * {
 *   "expires_in_seconds": 900,
 *   "session_metadata": { "requested_by": "user@example.com", ... }
 * }
 *
 * Response:
 * { ok: true, session_id, endpoint, expires_at }
 */
router.post('/sku/:sku_id/preview', async (req: Request, res: Response) => {
  const skuId = String(req.params.sku_id || '').trim();
  if (!skuId) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_SKU_ID', message: 'sku_id is required' } });
  }

  const body = req.body || {};
  const ttl = Number(body.expires_in_seconds || body.ttl_seconds || 900);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 60 * 60 * 4) {
    return res.status(400).json({ ok: false, error: { code: 'INVALID_TTL', message: 'expires_in_seconds must be >0 and <= 14400 (4h)' } });
  }

  const sessionMetadata = body.session_metadata || {};
  const requestId = req.context?.requestId;

  try {
    const startResult = await startSandbox(skuId, ttl, sessionMetadata, requestId);

    // create session record (in-memory for now)
    const session: PreviewSession = {
      session_id: startResult.session_id,
      sku_id: skuId,
      endpoint: startResult.endpoint,
      expires_at: startResult.expires_at,
      started_at: startResult.started_at,
      status: startResult.status as any,
      metadata: sessionMetadata,
    };

    sessions.set(session.session_id, session);

    // Emit audit event (preview.started)
    await emitAuditEvent('preview.started', req.context?.actorId, {
      session_id: session.session_id,
      sku_id: skuId,
      expires_at: session.expires_at,
      session_metadata: sessionMetadata,
      request_id: requestId,
    });

    return res.json({
      ok: true,
      session_id: session.session_id,
      endpoint: session.endpoint,
      expires_at: session.expires_at,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'PREVIEW_START_FAILED', message: err?.message || 'Failed to start preview sandbox' } });
  }
});

/**
 * GET /preview/:session_id
 * Returns status and logs metadata for the preview session (admin/operator).
 */
router.get('/preview/:session_id', async (req: Request, res: Response) => {
  const sessionId = String(req.params.session_id || '').trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_SESSION_ID', message: 'session_id is required' } });
  }

  // First try to read session from in-memory store
  let session = sessions.get(sessionId);

  // If not present and DB exists, try DB lookup (optional)
  if (!session) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dbMod = require('../lib/db');
      const db = dbMod && (dbMod.default || dbMod);
      if (db && typeof db.query === 'function') {
        const q = `SELECT session_id, sku_id, endpoint, started_at, expires_at, status, metadata FROM preview_sessions WHERE session_id = $1 LIMIT 1`;
        const r = await db.query(q, [sessionId]);
        if (r && r.rows && r.rows.length > 0) {
          const row = r.rows[0];
          session = {
            session_id: row.session_id,
            sku_id: row.sku_id,
            endpoint: row.endpoint,
            started_at: row.started_at,
            expires_at: row.expires_at,
            status: row.status || 'running',
            metadata: row.metadata,
          };
        }
      }
    } catch (e) {
      console.debug('DB not available or preview_sessions table missing:', (e as Error).message);
    }
  }

  if (!session) {
    return res.status(404).json({ ok: false, error: { code: 'PREVIEW_SESSION_NOT_FOUND', message: `Preview session ${sessionId} not found` } });
  }

  // Evaluate expiry
  const now = new Date();
  const expiresAt = new Date(session.expires_at);
  if (expiresAt <= now && session.status === 'running') {
    // mark expired
    session.status = 'expired';
    sessions.set(session.session_id, session);
    // emit audit event preview.expired
    await emitAuditEvent('preview.expired', req.context?.actorId, {
      session_id: session.session_id,
      sku_id: session.sku_id,
      expired_at: now.toISOString(),
    });
  }

  return res.json({
    ok: true,
    session_id: session.session_id,
    status: session.status,
    started_at: session.started_at,
    expires_at: session.expires_at,
    endpoint: session.endpoint,
    metadata: session.metadata,
  });
});

export default router;
