import fs from 'fs';
import path from 'path';
import { ProofService } from '../service/src/services/proofService';
import { InMemoryLedgerRepository } from '../service/src/db/repository/ledgerRepository';
import { SigningProxy } from '../service/src/services/signingProxy';
import { AuditService } from '../service/src/audit/auditService';
import { StripeAdapter } from '../service/src/integrations/stripeAdapter';
import { PayoutProviderAdapter } from '../service/src/integrations/payoutProviderAdapter';
import { ReconciliationService } from '../service/src/services/reconciliationService';

interface ExporterOptions {
  from: string;
  to: string;
  outputDir: string;
}

export async function runExporter({ from, to, outputDir }: ExporterOptions): Promise<void> {
  const repo = new InMemoryLedgerRepository();
  const signingProxy = new SigningProxy('kms.local');
  const proofService = new ProofService(repo, signingProxy);
  const reconciliation = new ReconciliationService(
    repo,
    new StripeAdapter('sk_test'),
    new PayoutProviderAdapter('https://payout.local')
  );
  const auditService = new AuditService();

  const proofs = await proofService.buildProof(from, to, []);
  const report = await reconciliation.reconcile(from, to);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'proof_package.json'), JSON.stringify(proofs, null, 2));
  fs.writeFileSync(path.join(outputDir, 'reconciliation_report.json'), JSON.stringify(report, null, 2));
  const auditLines = auditService.getEvents().map((evt) => JSON.stringify(evt)).join('\n');
  fs.writeFileSync(path.join(outputDir, 'audit_log.jsonl'), auditLines);
}

if (require.main === module) {
  const [from, to, out] = process.argv.slice(2);
  if (!from || !to) {
    console.error('Usage: canonical_exporter <from> <to> [outputDir]');
    process.exit(1);
  }
  runExporter({ from, to, outputDir: out ?? './exports' }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
