
import { Pool } from 'pg';
import { appendAuditEvent, AuditEvent } from '../../src/auditStore';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import signingProxy from '../../src/signingProxy';

// Mock dependencies
jest.mock('@aws-sdk/client-s3');
jest.mock('../../src/audit/infra/publisher', () => ({
  getPublisher: () => ({ publish: jest.fn().mockResolvedValue(undefined) })
}));
jest.mock('../../src/audit/infra/archiver', () => ({
  getArchiver: () => ({ archive: jest.fn().mockResolvedValue(undefined) })
}));

describe('Audit Chain Integration', () => {
  let pool: Pool;

  beforeAll(async () => {
    // Setup DB connection (assuming local test DB is available or we use a mock)
    // For integration tests in this repo, we usually rely on docker-compose or similar.
    // If not available, we might skip or mock pg.
    // Given the environment, we might not have a running PG.
    // I'll check if I can use a real PG connection if env vars are set, otherwise mock.

    // For this test, to fully verify the chain tool, we need to generate real events with signatures.
    // We can use the logic in appendAuditEvent but mock the DB part if needed,
    // OR we can assume we are writing to a real DB if configured.

    // Actually, I'll mock the DB to control the output and just test the generation + verification loop.
    // But `appendAuditEvent` relies on `getClient`.

    // Let's Mock `getClient` and `query`.
  });

  it('should generate a chain of events and verify them with the python tool', async () => {
    // 1. Generate 3 events
    // We need to simulate appendAuditEvent behavior manually or by mocking the DB calls it makes.
    // Since `appendAuditEvent` is hard to mock partially (it's the unit under test),
    // I will mock the DB calls it makes to return "previous hash".

    const events: AuditEvent[] = [];
    let prevHash: string | null = null;

    // Mock getClient/query
    const mockQuery = jest.fn();
    const mockRelease = jest.fn();
    const mockClient = { query: mockQuery, release: mockRelease };

    jest.spyOn(require('../../src/db'), 'getClient').mockResolvedValue(mockClient);

    // Mock SigningProxy to use a known key we can export to the python tool?
    // SigningProxy uses a local key in dev. We can extract it.
    const { publicKey } = await signingProxy.getPublicKey();
    const publicKeyPath = path.resolve(__dirname, 'test_public_key.pem');

    // signingProxy.getPublicKey returns base64 DER or something else?
    // In LocalSigningProvider: exported.toString('base64') of DER SPKI.
    // Python expects PEM usually or DER.
    // The python script does `serialization.load_pem_public_key(public_key_pem.encode('utf-8'))`
    // So we need to convert the base64 DER to PEM format.
    const pem = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----\n`;
    fs.writeFileSync(publicKeyPath, pem);

    // Helper to simulate append
    const simulateAppend = async (i: number) => {
      // Mock DB interactions
      // 1. BEGIN
      mockQuery.mockResolvedValueOnce({});
      // 2. SELECT hash (prevHash)
      mockQuery.mockResolvedValueOnce({ rows: prevHash ? [{ hash: prevHash }] : [] });
      // 3. Check idempotency (none)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 4. INSERT (capture the values)
      mockQuery.mockImplementationOnce((sql, params) => {
        // params: id, eventType, payload, prevHash, hash, signature, signerId, ts
        const [id, eventType, payload, ph, hash, signature, signerId, ts] = params;
        const event: AuditEvent = {
            id, eventType, payload, prevHash: ph, hash, signature, signerId, ts
        };
        events.push(event);
        prevHash = hash;
        return { rows: [] };
      });
      // 5. COMMIT
      mockQuery.mockResolvedValueOnce({});

      await appendAuditEvent(`TEST_EVENT_${i}`, { data: `value_${i}` });
    };

    await simulateAppend(1);
    await simulateAppend(2);
    await simulateAppend(3);

    expect(events.length).toBe(3);
    expect(events[1].prevHash).toBe(events[0].hash);
    expect(events[2].prevHash).toBe(events[1].hash);

    // 2. Dump to file
    const dumpPath = path.resolve(__dirname, 'audit_dump.json');
    fs.writeFileSync(dumpPath, JSON.stringify(events, null, 2));

    // 3. Run verify tool
    // We need to install python deps? 'cryptography' might be missing.
    // The python script handles missing crypto gracefully (mocks it).
    // If we want REAL verification, we need `cryptography`.
    // I'll try running it.

    try {
      // Correct path resolution: we are in kernel/test/integration/
      // Root is ../../../
      // We want to run python3 kernel/tools/verify_audit_chain.py from ROOT.
      // path.resolve(__dirname, '../../../../') might be pointing to /app/kernel/test/integration/../../../../ = / ?
      // Let's check where the CWD is.
      // If we are in /app, then kernel/tools/... works.

      // Correct path resolution: we are in kernel/test/integration/
      // Root is ../../../

      const repoRoot = path.resolve(__dirname, '../../../');

      const output = execSync(`python3 kernel/tools/verify_audit_chain.py --file ${dumpPath} --public-key ${publicKeyPath}`, {
        cwd: repoRoot
      });
      console.log(output.toString());
    } catch (e: any) {
      console.error(e.stdout?.toString());
      console.error(e.stderr?.toString());
      throw e;
    }

    // Cleanup
    fs.unlinkSync(dumpPath);
    fs.unlinkSync(publicKeyPath);
  });
});
