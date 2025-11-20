/**
 * marketplace/server/routes/agent.route.ts
 *
 * Express router that exposes a server-side agent proxy endpoint:
 *  POST /api/agent/query
 *
 * The route accepts a JSON body `{ prompt, context }`, forwards the request
 * to the configured agent backend via `server/lib/agentProxy.ts`, and returns
 * the agent reply. The server-side proxy is the required security boundary:
 * it must authenticate the caller, enrich context, enforce allowed actions,
 * and audit the agent invocation.
 */

import { Router, Request, Response } from 'express';
import agentProxy from '../lib/agentProxy';
import auditWriter from '../lib/auditWriter';

const router = Router();

/**
 * Simple authentication helper: prefer service-side auth logic.
 * This is intentionally minimal: in production you should replace it with
 * real auth/middleware (JWT or mTLS/client cert checks).
 */
function getActorIdFromReq(req: Request): string | null {
  // If a validated JWT was attached by earlier middleware, prefer that.
  if ((req as any).actor_id) return (req as any).actor_id;
  const auth = String(req.header('Authorization') || '').trim();
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    // For dev convenience, support demo tokens like "demo-token:email"
    if (token.startsWith('demo-token')) return `agent:anonymous`;
    // Otherwise return a bound actor id placeholder
    return `actor:anonymous`;
  }
  return null;
}

router.post('/api/agent/query', async (req: Request, res: Response) => {
  const body = req.body || {};
  const prompt = body.prompt;
  const context = body.context || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ ok: false, error: { message: 'prompt is required' } });
  }

  const actorId = getActorIdFromReq(req) || 'agent:unauthenticated';

  // Audit: record agent.query request (best-effort)
  try {
    await auditWriter
      .write({
        actor: actorId,
        action: 'agent.query.request',
        details: { prompt: typeof prompt === 'string' ? `${String(prompt).slice(0, 512)}` : '', context },
      })
      .catch(() => {
      // swallow audit errors, but log
      // eslint-disable-next-line no-console
      console.debug('audit append failed for agent.query.request');
    });
  } catch {
    // ignore
  }

  try {
    const reply = await agentProxy.queryAgent({ prompt, context, actorId });

    // Audit: record agent reply (best-effort)
    try {
      await auditWriter
        .write({
          actor: actorId,
          action: 'agent.query.response',
          details: {
            promptSummary: (typeof prompt === 'string' ? String(prompt).slice(0, 256) : ''),
            reply: (reply && (reply.reply || reply.text || '')).toString().slice(0, 1024),
            meta: reply.meta || null,
          },
        })
        .catch(() => {
        // eslint-disable-next-line no-console
        console.debug('audit append failed for agent.query.response');
      });
    } catch {
      // ignore
    }

    return res.json(reply);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('agent.route: agentProxy.queryAgent error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Agent proxy failed', details: String(err) } });
  }
});

export default router;
