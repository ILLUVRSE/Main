import crypto from 'crypto';
import { loadConfig } from './server/config';
import { LedgerService } from './services/ledgerService';
import { AuditService } from './audit/auditService';
import { PostgresLedgerRepository } from './db/postgresLedgerRepository';
import { InMemoryLedgerRepository } from './db/repository/ledgerRepository';
import { normalizeJournalRequest, ApiJournalBody } from './utils/journalNormalizer';

let ledgerService: LedgerService | null = null;

function getLedgerService(): LedgerService {
  if (ledgerService) return ledgerService;
  const config = loadConfig();
  const repo =
    config.ledgerRepo === 'postgres'
      ? new PostgresLedgerRepository({ connectionString: config.databaseUrl })
      : new InMemoryLedgerRepository();
  ledgerService = new LedgerService(repo, new AuditService());
  return ledgerService;
}

interface PostJournalOptions {
  actor?: string;
  idempotencyKey?: string;
}

export async function postJournal(payload: ApiJournalBody, options: PostJournalOptions = {}) {
  const service = getLedgerService();
  const entries = normalizeJournalRequest(payload);
  const actor = options.actor || 'ledger-module';
  const idempotencyKey = options.idempotencyKey || payloadKey(entries);
  const committed = await service.postEntries(entries, actor, { idempotencyKey });
  return {
    ok: true,
    journal_id: committed[0]?.journalId,
    journal_ids: committed.map((entry) => entry.journalId),
    posted_at: committed[0]?.timestamp,
  };
}

export async function getJournal(journalId: string) {
  const journal = await getLedgerService().getJournal(journalId);
  if (!journal) return null;
  return {
    ok: true,
    journal,
  };
}

function payloadKey(entries: any[]): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  return `journal:${hash}`;
}
