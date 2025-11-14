import { Pool } from 'pg';
import { AuditService } from '../../service/src/audit/auditService';
import { LedgerService } from '../../service/src/services/ledgerService';
import { PayoutService } from '../../service/src/services/payoutService';
import { PayoutProviderAdapter } from '../../service/src/integrations/payoutProviderAdapter';
import { PostgresLedgerRepository } from '../../service/src/db/postgresLedgerRepository';
import { setupDatabase } from '../helpers/postgres';
import { runExporter } from '../../exports/canonical_exporter';
import { verifyPackage } from '../../exports/audit_verifier_cli';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ensureKmsKey } from '../../infra/bootstrap_localstack';
import { Payout } from '../../service/src/models/payout';

describe('payment+payout flow', () => {
  let pool: Pool;
  let ledgerService: LedgerService;
  let payoutService: PayoutService;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgres://postgres:finance@127.0.0.1:5433/finance';
    process.env.LEDGER_REPO = 'postgres';
    process.env.AWS_REGION ??= 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID ??= 'test';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
    process.env.KMS_ENDPOINT ??= 'http://127.0.0.1:4566';
    process.env.S3_AUDIT_BUCKET ??= 'finance-audit';
    process.env.S3_ENDPOINT ??= 'http://127.0.0.1:4566';
    process.env.PAYOUT_PROVIDER_ENDPOINT ??= 'http://127.0.0.1:4100';
    process.env.STRIPE_API_BASE ??= 'http://127.0.0.1:12111';
    process.env.STRIPE_API_KEY ??= 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_test';
    const keyId = await ensureKmsKey();
    process.env.KMS_KEY_ID = keyId;
    pool = await setupDatabase();
    const repo = new PostgresLedgerRepository({ pool });
    const audit = new AuditService();
    ledgerService = new LedgerService(repo, audit);
    payoutService = new PayoutService(
      repo,
      audit,
      new PayoutProviderAdapter({ endpoint: process.env.PAYOUT_PROVIDER_ENDPOINT })
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('processes payment, enforces multisig approvals, exports verifiable proof', async () => {
    const now = new Date().toISOString();
    await ledgerService.postEntries(
      [
        {
          journalId: '00000000-0000-0000-0000-000000000001',
          batchId: '00000000-0000-0000-0000-000000000002',
          timestamp: now,
          currency: 'USD',
          lines: [
            { accountId: 'cash', direction: 'debit', amount: 500_000_00 },
            { accountId: 'revenue', direction: 'credit', amount: 500_000_00 },
          ],
        },
      ],
      'finance@example.com'
    );

    await payoutService.requestPayout(
      {
        payoutId: '00000000-0000-0000-0000-000000000003',
        amount: 300_000_00,
        currency: 'USD',
        destination: { provider: 'mock', accountReference: 'acct_e2e' },
        memo: 'creator distribution',
        requestedBy: 'finance@example.com',
        status: 'pending_approval',
        approvals: [],
      },
      'finance@example.com'
    );

    const approvals = [
      { role: 'FinanceLead', approver: 'lead@example.com', signature: 'sig1' },
      { role: 'SecurityEngineer', approver: 'sec@example.com', signature: 'sig2' },
      { role: 'SuperAdmin', approver: 'admin@example.com', signature: 'sig3' },
    ];
    let released: Payout | undefined;
    for (const approval of approvals) {
      released = await payoutService.recordApproval('00000000-0000-0000-0000-000000000003', {
        ...approval,
        approvedAt: new Date().toISOString(),
      });
    }

    expect(released?.status).toBe('released');
    expect(released?.approvals).toHaveLength(3);

    const { proofKey } = await runExporter({
      from: '2024-01-01T00:00:00Z',
      to: '2025-01-01T00:00:00Z',
      s3Prefix: `tests/${Date.now()}`,
      signerRoles: approvals.map((a) => a.role),
      actor: 'test-suite',
    });

    const pkg = await fetchProofFromS3(process.env.S3_AUDIT_BUCKET!, proofKey);
    await expect(verifyPackage(pkg)).resolves.toBe(true);
  });
});

async function fetchProofFromS3(bucket: string, key: string) {
  const client = new S3Client({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  });
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await object.Body?.transformToString();
  if (!body) throw new Error('Empty proof body');
  return JSON.parse(body);
}
