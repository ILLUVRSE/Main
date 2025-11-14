import { createKernelMockServer } from '../../mock/kernelMockServer.js';
import { AddressInfo } from 'net';
import { deterministicId } from '../../src/utils/deterministic.js';

type KernelHandle = {
  baseUrl: string;
  close: () => Promise<void>;
};

const createInMemoryKernelMock = (): KernelHandle => {
  const audits: any[] = [];
  const upgrades = new Map<
    string,
    { approvals: { approver: string; approvedAt: string }[]; appliedAt: string | null; payload: any }
  >();
  const baseUrl = 'http://kernel.virtual';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== baseUrl) {
      return originalFetch(input, init);
    }

    const respond = (status: number, body: any) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

    if (url.pathname === '/health') {
      return respond(200, { status: 'ok', audits: audits.length });
    }

    const body = init?.body ? JSON.parse(init.body.toString()) : {};

    if (url.pathname === '/audit/log' && init?.method === 'POST') {
      const audit = {
        auditId: deterministicId(JSON.stringify(body.event), 'audit'),
        event: body.event,
      };
      audits.push(audit);
      return respond(200, audit);
    }

    if (url.pathname === '/audit/search' && init?.method === 'POST') {
      const results = audits.filter((audit) =>
        Object.entries(body.criteria || {}).every(([key, value]) => audit.event?.[key] === value),
      );
      return respond(200, { results });
    }

    if (url.pathname === '/multisig/upgrade' && init?.method === 'POST') {
      const upgradeId = deterministicId(JSON.stringify(body), 'upg');
      upgrades.set(upgradeId, { approvals: [], appliedAt: null, payload: body });
      return respond(200, { upgradeId });
    }

    const upgradeMatch = url.pathname.match(/\/multisig\/upgrade\/(.+)\/(approve|apply)/);
    if (upgradeMatch) {
      const [, upgradeId, action] = upgradeMatch;
      const upgrade = upgrades.get(upgradeId);
      if (!upgrade) {
        return respond(404, { message: 'Upgrade not found' });
      }
      if (action === 'approve' && init?.method === 'POST') {
        upgrade.approvals.push({ approver: body.approver, approvedAt: new Date().toISOString() });
        return respond(200, { approvals: upgrade.approvals });
      }
      if (action === 'apply' && init?.method === 'POST') {
        upgrade.appliedAt = new Date().toISOString();
        return respond(200, { approvals: upgrade.approvals, appliedAt: upgrade.appliedAt });
      }
    }

    return respond(404, { message: 'Not found' });
  };

  return {
    baseUrl,
    close: async () => {
      globalThis.fetch = originalFetch;
    },
  };
};

export const startKernelMock = async (): Promise<KernelHandle> => {
  if (process.env.VITEST_ENABLE_NET === '1') {
    const server = createKernelMockServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return {
      baseUrl,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    };
  }

  return createInMemoryKernelMock();
};
