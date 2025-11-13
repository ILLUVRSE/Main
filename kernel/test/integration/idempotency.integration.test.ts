import express from 'express';
import request from '../utils/mockSupertest';
import createKernelRouter from '../../src/routes/kernelRoutes';
import * as dbModule from '../../src/db';
import { MockDb } from '../utils/mockDb';
import { enforcePolicyOrThrow } from '../../src/sentinel/sentinelClient';
import signingProxy from '../../src/signingProxy';
import { appendAuditEvent } from '../../src/auditStore';

jest.mock('../../src/sentinel/sentinelClient', () => ({
  enforcePolicyOrThrow: jest.fn(),
}));

jest.mock('../../src/auditStore', () => ({
  appendAuditEvent: jest.fn().mockResolvedValue(undefined),
  getAuditEventById: jest.fn(),
}));

jest.mock('../../src/signingProxy', () => ({
  __esModule: true,
  default: {
    signManifest: jest.fn(),
    signData: jest.fn(),
    _internal: {},
  },
}));

const signManifestMock = signingProxy.signManifest as jest.Mock;

describe('POST /kernel/division idempotency', () => {
  let db: MockDb;
  let app: express.Express;

  beforeEach(() => {
    db = new MockDb();
    jest.spyOn(dbModule, 'getClient').mockImplementation(async () => db.createClient());
    (enforcePolicyOrThrow as jest.Mock).mockResolvedValue({ allowed: true });
    signManifestMock.mockImplementation(async (manifest: any) => {
      return {
        id: `sig-${manifest.id}`,
        manifestId: manifest.id,
        signerId: 'test-signer',
        signature: 'signature',
        version: manifest.version ?? '1.0.0',
        ts: new Date().toISOString(),
        prevHash: null,
      };
    });

    app = express();
    app.use(express.json());
    app.use(createKernelRouter());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    signManifestMock.mockReset();
    (appendAuditEvent as jest.Mock).mockClear();
    (enforcePolicyOrThrow as jest.Mock).mockReset();
  });

  test('replays response on retry without duplicating manifests', async () => {
    const manifest = {
      id: 'division-1',
      name: 'Alpha Division',
      goals: [],
    };

    const first = await request(app)
      .post('/kernel/division')
      .set('Idempotency-Key', 'div-key-1')
      .send(manifest);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject(manifest);
    expect(signManifestMock).toHaveBeenCalledTimes(1);

    const second = await request(app)
      .post('/kernel/division')
      .set('Idempotency-Key', 'div-key-1')
      .send(manifest);

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject(manifest);
    expect(signManifestMock).toHaveBeenCalledTimes(1);

    const state = db.getState();
    expect(state.manifest_signatures.size).toBe(1);
    expect(state.divisions.size).toBe(1);
    expect(state.idempotency.size).toBe(1);
  });
});
