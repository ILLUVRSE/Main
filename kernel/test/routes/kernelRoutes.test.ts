
import express from 'express';
import request from '../utils/mockSupertest';
import createKernelRouter from '../../src/routes/kernelRoutes';
import signingProxy from '../../src/signingProxy';
import * as auditStore from '../../src/auditStore';
import * as dbModule from '../../src/db';

// Mock dependencies
jest.mock('../../src/signingProxy');
jest.mock('../../src/auditStore');
jest.mock('../../src/db'); // Mock DB to avoid connection attempt

describe('POST /kernel/sign', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // In test env, kernelRoutes won't enforce auth by default unless we set IS_PRODUCTION
    // But kernelRoutes.ts checks process.env.NODE_ENV === 'production'
    // We can assume dev mode allows unauth access, which is what we want to test first.
    app.use(createKernelRouter());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 if manifest is missing', async () => {
    // Mock getClient because idempotency middleware calls it
    (dbModule.getClient as jest.Mock).mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
      release: jest.fn(),
    });

    const res = await request(app).post('/kernel/sign').set('Idempotency-Key', 'idem-1').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'missing manifest in body');
  });

  test('signs manifest and returns signature record', async () => {
    const manifest = { id: 'man-1', version: '1.0.0' };

    // Mock signingProxy
    (signingProxy.signManifest as jest.Mock).mockResolvedValue({
      id: 'sig-uuid',
      manifestId: 'man-1',
      signerId: 'test-signer',
      signature: 'base64sig',
      algorithm: 'ed25519',
      keyVersion: 'v1',
      version: '1.0.0',
      ts: '2023-01-01T00:00:00Z',
      prevHash: null,
    });

    // Mock DB insert
    (dbModule.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 1 } as any);
    (dbModule.getClient as jest.Mock).mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 } as any),
      release: jest.fn(),
    } as any);

    // Mock Audit
    (auditStore.appendAuditEvent as jest.Mock).mockResolvedValue({ id: 'audit-1' });

    const res = await request(app).post('/kernel/sign').set('Idempotency-Key', 'idem-2').send({ manifest });

    expect(res.status).toBe(200);
    expect(res.body.signature_record).toMatchObject({
      id: 'sig-uuid',
      manifest_id: 'man-1',
      signer_id: 'test-signer',
      signature: 'base64sig',
      algorithm: 'ed25519',
      key_version: 'v1',
    });
    expect(res.body.audit_id).toBe('audit-1');

    // Verify DB insert called
    // We expect insert into manifest_signatures
    // The implementation uses resolveClient, which calls getClient() if idempotency middleware didn't attach one.
    // Idempotency middleware is used.
  });
});
