import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { loadConfig } from '../service/src/server/config';
import { PostgresLedgerRepository } from '../service/src/db/postgresLedgerRepository';
import { InMemoryLedgerRepository } from '../service/src/db/repository/ledgerRepository';
import { ProofService } from '../service/src/services/proofService';
import { SigningProxy } from '../service/src/services/signingProxy';
import { StripeAdapter } from '../service/src/integrations/stripeAdapter';
import { PayoutProviderAdapter } from '../service/src/integrations/payoutProviderAdapter';
import { ReconciliationService } from '../service/src/services/reconciliationService';
import { metrics } from '../service/src/monitoring/metrics';

interface ExporterOptions {
  from: string;
  to: string;
  s3Prefix?: string;
  signerRoles?: string[];
  actor?: string;
}

export async function runExporter({ from, to, s3Prefix, signerRoles, actor }: ExporterOptions): Promise<{ proofKey: string; reportKey: string }> {
  const startedAt = Date.now();
  const config = loadConfig();
  const repo =
    config.ledgerRepo === 'postgres'
      ? new PostgresLedgerRepository(config.databaseUrl)
      : new InMemoryLedgerRepository();
  const signingProxy = new SigningProxy({
    region: config.awsRegion,
    endpoint: config.kmsEndpoint,
    keyId: config.kmsKeyId,
  });
  const proofService = new ProofService(repo, signingProxy);
  const stripeAdapter = new StripeAdapter(config.stripe);
  const payoutAdapter = new PayoutProviderAdapter(config.payout);
  const reconciliation = new ReconciliationService(repo, stripeAdapter, payoutAdapter);
  const s3 = new S3Client({
    region: config.awsRegion,
    endpoint: process.env.S3_ENDPOINT ?? process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT ?? process.env.AWS_ENDPOINT_URL_S3),
  });

  const roles = signerRoles ?? (process.env.EXPORT_SIGNER_ROLES ? process.env.EXPORT_SIGNER_ROLES.split(',').map((r) => r.trim()).filter(Boolean) : ['FinanceLead']);
  const approvals = roles.map((role) => ({ role, signer: actor ?? process.env.USER ?? 'finance-export' }));
  const baseKey = s3Prefix ?? `proofs/${from}_${to}/${Date.now()}`;
  const proofKey = `${baseKey}/proof_package.json`;
  const reportKey = `${baseKey}/reconciliation_report.json`;

  const proof = await proofService.buildProof(from, to, approvals, roles, { s3ObjectKey: proofKey });
  const report = await reconciliation.reconcile(from, to);

  await ensureBucket(s3, config.storage.bucket, config.awsRegion);
  await uploadJson(s3, config.storage.bucket, proofKey, proof, config.kmsKeyId);
  await uploadJson(s3, config.storage.bucket, reportKey, report, config.kmsKeyId);

  metrics.observeExportDuration(Date.now() - startedAt);
  return { proofKey, reportKey };
}

async function ensureBucket(client: S3Client, bucket: string, region: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const input: any = {
      Bucket: bucket,
      ObjectLockEnabledForBucket: true,
    };
    if (region && region !== 'us-east-1') {
      input.CreateBucketConfiguration = { LocationConstraint: region };
    }
    await client.send(new CreateBucketCommand(input));
  }
}

async function uploadJson(client: S3Client, bucket: string, key: string, payload: unknown, kmsKeyId?: string): Promise<void> {
  const retention = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    ContentType: 'application/json',
    ServerSideEncryption: kmsKeyId ? 'aws:kms' : undefined,
    SSEKMSKeyId: kmsKeyId,
    ObjectLockMode: 'COMPLIANCE',
    ObjectLockRetainUntilDate: retention,
    Metadata: {
      'proof-exported-at': new Date().toISOString(),
    },
  });
  await client.send(command);
}

if (require.main === module) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    console.error('Usage: npm run finance:export -- <from> <to>');
    process.exit(1);
  }
  const config = loadConfig();
  runExporter({ from, to })
    .then(({ proofKey, reportKey }) => {
      console.log(`Exported proof to s3://${config.storage.bucket}/${proofKey}`);
      console.log(`Exported reconciliation to s3://${config.storage.bucket}/${reportKey}`);
      console.log(JSON.stringify({ proofKey, reportKey }));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
