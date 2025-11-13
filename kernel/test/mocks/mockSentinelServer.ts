/**
 * kernel/test/mocks/mockSentinelServer.ts
 *
 * Lightweight mock Sentinel policy server for tests.
 *
 * Endpoints:
 *  - GET  /health                 -> 200 { ok: true }
 *  - POST /evaluate               -> body { policy: string, context: object } -> decision
 *  - POST /record                 -> record an audit event (noop)
 *
 * The mock returns deterministic decisions:
 *  - If context.force === 'deny' -> allowed: false, reason: 'forced-deny'
 *  - If policy contains 'deny' -> allowed: false
 *  - Otherwise allowed: true
 *
 * This is NOT a real policy engine, just a deterministic test double.
 */

import express, { Request, Response } from 'express';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const PORT = Number(process.env.MOCK_SENTINEL_PORT || 7602);
const HOST = process.env.MOCK_SENTINEL_HOST || '127.0.0.1';
const SIGNER_ID = process.env.MOCK_SENTINEL_ID || 'mock-sentinel-v1';

function makeDecision(policy: string, ctx: any) {
  const now = new Date().toISOString();
  const forced = ctx?.force ?? ctx?.forced ?? null;
  if (forced === 'deny') {
    return {
      allowed: false,
      decisionId: `mock:${policy}:deny-forced`,
      ruleId: 'forced-deny',
      rationale: 'forced deny via ctx.force',
      timestamp: now,
    };
  }

  if (typeof policy === 'string' && policy.toLowerCase().includes('deny')) {
    return {
      allowed: false,
      decisionId: `mock:${policy}:deny`,
      ruleId: 'policy-deny',
      rationale: 'policy rule matched deny',
      timestamp: now,
    };
  }

  // default allow
  return {
    allowed: true,
    decisionId: `mock:${policy}:allow`,
    ruleId: 'policy-allow',
    rationale: 'default allow (mock)',
    timestamp: now,
  };
}

function createApp() {
  const app = express();

  // Use express built-in json parser (no body-parser default import needed)
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, sentinel: SIGNER_ID });
  });

  app.post('/evaluate', (req: Request, res: Response) => {
    try {
      const policy = req.body?.policy || req.body?.policyName || 'default';
      const ctx = req.body?.context ?? req.body?.ctx ?? {};
      const decision = makeDecision(policy, ctx);
      // mimic sentinel envelope
      return res.json({
        decision,
        meta: { requestedAt: new Date().toISOString(), policy },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('mock-sentinel /evaluate error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  app.post('/record', (req: Request, res: Response) => {
    try {
      // no-op record endpoint
      // eslint-disable-next-line no-console
      console.info('mock-sentinel record', req.body?.type || '(no-type)');
      return res.json({ ok: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('mock-sentinel /record error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`mock-sentinel: listening on http://${HOST}:${PORT}`);
  });
}

export default createApp;
