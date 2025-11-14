import { Router } from 'express';
import { LedgerService } from '../services/ledgerService';
import { JournalEntry } from '../models/journalEntry';

export default function journalRouter(ledgerService: LedgerService): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const entries = req.body.entries as JournalEntry[];
      await ledgerService.postEntries(entries, req.headers['x-user-email'] as string);
      res.status(201).json({ committed: entries.map((e) => e.journalId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
