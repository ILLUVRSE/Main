// sentinelnet/src/mock/kernelMockServer.ts
import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';

export interface KernelMockState {
  auditEvents: any[];
  policyDecisions: any[];
  upgrades: Map<string, any>;
}

export function createKernelMockApp(state: KernelMockState) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'kernel-mock', ts: new Date().toISOString() });
  });

  app.post('/kernel/audit', (req: Request, res: Response) => {
    const eventType = req.body?.eventType;
    const payload = req.body?.payload ?? {};
    const id = `audit-${state.auditEvents.length + 1}`;
    const event = {
      id,
      eventType,
      payload,
      ts: new Date().toISOString(),
    };
    state.auditEvents.push(event);
    if (eventType === 'policy.decision') {
      state.policyDecisions.push(event);
    }
    res.status(202).json({ id, eventType });
  });

  app.post('/kernel/audit/search', (req: Request, res: Response) => {
    const timeMin = req.body?.time_min;
    let events = state.auditEvents.slice();
    if (timeMin) {
      events = events.filter((ev) => !ev.ts || ev.ts >= timeMin);
    }
    const limit = req.body?.limit ? Number(req.body.limit) : undefined;
    if (limit && limit > 0) {
      events = events.slice(-limit);
    }
    res.json({ events });
  });

  app.post('/kernel/upgrade', (req: Request, res: Response) => {
    const manifest = req.body?.manifest ?? {};
    const submittedBy = req.body?.submittedBy ?? null;
    const upgradeId = manifest.upgradeId || `upgrade-${crypto.randomUUID()}`;
    const upgrade = {
      id: `db-${upgradeId}`,
      upgradeId,
      manifest,
      status: 'pending',
      submittedBy,
      submittedAt: new Date().toISOString(),
      approvals: [] as any[],
    };
    state.upgrades.set(upgradeId, upgrade);
    res.status(201).json({ upgrade });
  });

  app.post('/kernel/upgrade/:id/approve', (req: Request, res: Response) => {
    const upgradeId = req.params.id;
    const upgrade = state.upgrades.get(upgradeId);
    if (!upgrade) {
      return res.status(404).json({ error: 'upgrade_not_found' });
    }
    const approval = {
      approverId: req.body?.approverId,
      signature: req.body?.signature ?? '',
      notes: req.body?.notes ?? null,
      ts: new Date().toISOString(),
    };
    upgrade.approvals.push(approval);
    res.status(201).json({ approval });
  });

  app.post('/kernel/upgrade/:id/apply', (req: Request, res: Response) => {
    const upgradeId = req.params.id;
    const upgrade = state.upgrades.get(upgradeId);
    if (!upgrade) {
      return res.status(404).json({ error: 'upgrade_not_found' });
    }
    upgrade.status = 'applied';
    upgrade.appliedBy = req.body?.appliedBy ?? null;
    upgrade.appliedAt = new Date().toISOString();
    res.json({ upgrade });
  });

  app.get('/kernel/upgrade/:id', (req: Request, res: Response) => {
    const upgradeId = req.params.id;
    const upgrade = state.upgrades.get(upgradeId);
    if (!upgrade) return res.status(404).json({ error: 'upgrade_not_found' });
    res.json({ upgrade });
  });

  return app;
}

export async function startKernelMockServer(port = 0) {
  const state: KernelMockState = {
    auditEvents: [],
    policyDecisions: [],
    upgrades: new Map(),
  };
  const app = createKernelMockApp(state);
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}`;

  function stop() {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  function reset() {
    state.auditEvents.length = 0;
    state.policyDecisions.length = 0;
    state.upgrades.clear();
  }

  return { app, server, url, state, stop, reset };
}

if (require.main === module) {
  const port = Number(process.env.KERNEL_MOCK_PORT || 7802);
  startKernelMockServer(port)
    .then(({ url }) => {
      // eslint-disable-next-line no-console
      console.log(`Kernel mock listening on ${url}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to start kernel mock', err);
      process.exit(1);
    });
}
