const express = require('express');
const crypto = require('crypto');

const deterministicId = (input, prefix) =>
  `${prefix}_${crypto.createHash('sha256').update(input).digest('hex').slice(0, 12)}`;

function createKernelMockServer(options = {}) {
  const port = options.port ?? process.env.KERNEL_MOCK_PORT ?? 6050;
  const host = options.host ?? '127.0.0.1';
  const app = express();
  app.use(express.json());

  const audits = [];
  const upgrades = new Map();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', audits: audits.length });
  });

  app.post('/audit/log', (req, res) => {
    const event = req.body?.event || {};
    const audit = {
      auditId: deterministicId(JSON.stringify(event), 'audit'),
      event,
    };
    audits.push(audit);
    res.json(audit);
  });

  app.post('/audit/search', (req, res) => {
    const criteria = req.body?.criteria || {};
    const matches = audits.filter((audit) =>
      Object.entries(criteria).every(([key, value]) => audit.event?.[key] === value),
    );
    res.json({ results: matches });
  });

  app.post('/multisig/upgrade', (req, res) => {
    const payload = req.body || {};
    const upgradeId = deterministicId(JSON.stringify(payload), 'upg');
    const record = {
      upgradeId,
      approvals: [],
      payload,
      appliedAt: null,
    };
    upgrades.set(upgradeId, record);
    res.json({ upgradeId });
  });

  app.post('/multisig/upgrade/:id/approve', (req, res) => {
    const upgrade = upgrades.get(req.params.id);
    if (!upgrade) {
      res.status(404).json({ message: 'Upgrade not found' });
      return;
    }
    const approver = req.body?.approver;
    if (!approver) {
      res.status(400).json({ message: 'approver required' });
      return;
    }
    upgrade.approvals.push({
      approver,
      approvedAt: new Date().toISOString(),
    });
    res.json({ approvals: upgrade.approvals });
  });

  app.post('/multisig/upgrade/:id/apply', (req, res) => {
    const upgrade = upgrades.get(req.params.id);
    if (!upgrade) {
      res.status(404).json({ message: 'Upgrade not found' });
      return;
    }
    upgrade.appliedAt = new Date().toISOString();
    res.json({
      approvals: upgrade.approvals,
      appliedAt: upgrade.appliedAt,
    });
  });

  const server = app.listen(port, host, () => {
    console.log(`[kernel-mock] listening on ${host}:${server.address().port}`);
  });
  return server;
}

module.exports = { createKernelMockServer };

if (require.main === module) {
  createKernelMockServer();
}
