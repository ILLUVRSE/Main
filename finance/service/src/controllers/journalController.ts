import { Router } from 'express';
import { LedgerService } from '../services/ledgerService';
import { normalizeJournalRequest, ApiJournalBody } from '../utils/journalNormalizer';

export default function journalRouter(ledgerService: LedgerService): Router {
  const router = Router();

  router.post('/post', async (req, res, next) => {
    try {
      const entries = normalizeJournalRequest(req.body as ApiJournalBody);
      const actor = (req.headers['x-user-email'] as string) || 'finance-service';
      const idempotencyKey = (req.headers['idempotency-key'] as string) || req.header('Idempotency-Key') || undefined;
      const committed = await ledgerService.postEntries(entries, actor, { idempotencyKey });
      res.status(201).json({ ok: true, journal_ids: committed.map((entry) => entry.journalId) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:journalId', async (req, res, next) => {
    try {
      const journal = await ledgerService.getJournal(req.params.journalId);
      if (!journal) {
        return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Journal not found' } });
      }
      res.json({ ok: true, journal });
    } catch (err) {
      next(err);
    }
  });

  // Allocation endpoint
  router.post('/allocate', async (req, res, next) => {
    try {
      const actor = (req.headers['x-user-email'] as string) || 'finance-service';
      const result = await ledgerService.createAllocation(req.body, actor);
      res.json({ ok: true, ...result });
    } catch (err) {
        next(err);
    }
  });

  return router;
}
