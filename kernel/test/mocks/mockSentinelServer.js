// kernel/test/mocks/mockSentinelServer.js
// Simple, zero-dependency (except express) mock sentinel server for tests.

const express = require('express');
const crypto = require('crypto');

const PORT = Number(process.env.MOCK_SENTINEL_PORT || 7602);
const HOST = process.env.MOCK_SENTINEL_HOST || '127.0.0.1';
const SIGNER_ID = process.env.MOCK_SENTINEL_ID || 'mock-sentinel-v1';

function makeDecision(policy, ctx) {
  const now = new Date().toISOString();
  const forced = (ctx && (ctx.force || ctx.forced)) || null;
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
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, sentinel: SIGNER_ID });
  });

  app.post('/evaluate', (req, res) => {
    try {
      const policy = req.body?.policy || req.body?.policyName || 'default';
      const ctx = req.body?.context ?? req.body?.ctx ?? {};
      const decision = makeDecision(policy, ctx);
      return res.json({
        decision,
        meta: { requestedAt: new Date().toISOString(), policy },
      });
    } catch (err) {
      console.error('mock-sentinel /evaluate error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  app.post('/record', (req, res) => {
    try {
      console.info('mock-sentinel record', req.body?.type || '(no-type)');
      return res.json({ ok: true });
    } catch (err) {
      console.error('mock-sentinel /record error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`mock-sentinel: listening on http://${HOST}:${PORT}`);
  });
}

module.exports = createApp;

