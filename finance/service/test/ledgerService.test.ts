import { LedgerService } from '../src/services/ledgerService';
import { InMemoryLedgerRepository } from '../src/db/repository/ledgerRepository';
import { AuditService } from '../src/audit/auditService';
import { randomUUID } from 'crypto';

describe('LedgerService', () => {
  let ledgerService: LedgerService;
  let repo: InMemoryLedgerRepository;
  let audit: AuditService;

  beforeEach(() => {
    repo = new InMemoryLedgerRepository();
    audit = new AuditService();
    ledgerService = new LedgerService(repo, audit);
  });

  it('should create an allocation with double-entry accounting', async () => {
    const actor = 'test-actor';
    const req = {
      entityId: 'test-entity',
      resources: { cpu: 1 },
      idempotencyKey: 'idem-1'
    };

    const result = await ledgerService.createAllocation(req, actor);

    expect(result.status).toBe('reserved');

    // Verify journal entry
    const journals = await repo.fetchLedgerRange(new Date(0).toISOString(), new Date().toISOString());
    expect(journals.length).toBe(1);

    const entry = journals[0];
    const debits = entry.lines.filter(l => l.direction === 'debit');
    const credits = entry.lines.filter(l => l.direction === 'credit');

    expect(debits.length).toBe(1);
    expect(credits.length).toBe(1);
    expect(debits[0].amount).toBe(100);
    expect(credits[0].amount).toBe(100);

    // Verify audit
    const events = audit.getEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.find(e => e.eventType === 'allocation.created')).toBeDefined();
  });

  it('should be idempotent', async () => {
    const actor = 'test-actor';
    const req = {
      entityId: 'test-entity',
      resources: { cpu: 1 },
      idempotencyKey: 'idem-1'
    };

    await ledgerService.createAllocation(req, actor);

    // Second call
    await ledgerService.createAllocation(req, actor);

    // Should still have only 1 journal
    const journals = await repo.fetchLedgerRange(new Date(0).toISOString(), new Date().toISOString());
    expect(journals.length).toBe(1);
  });
});
