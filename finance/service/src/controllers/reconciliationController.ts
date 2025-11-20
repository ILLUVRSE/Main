import { Router } from 'express';
import { ReconciliationService } from '../services/reconciliationService';
import { ValidationError } from '../utils/errors';

interface ReconcileJob {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  result?: Awaited<ReturnType<ReconciliationService['reconcile']>>;
  error?: string;
}

export default function reconciliationRouter(reconciliationService: ReconciliationService): Router {
  const router = Router();
  const jobs = new Map<string, ReconcileJob>();

  router.post('/', async (req, res, next) => {
    try {
      const { request_id: requestId, from_ts: from, to_ts: to } = req.body || {};
      if (!from || !to) {
        throw new ValidationError('from_ts and to_ts are required');
      }
      const jobId = requestId || `reconcile-${Date.now()}`;
      jobs.set(jobId, { id: jobId, status: 'pending' });
      reconciliationService
        .reconcile(from, to)
        .then((report) => {
          jobs.set(jobId, { id: jobId, status: 'completed', result: report });
        })
        .catch((error: Error) => {
          jobs.set(jobId, { id: jobId, status: 'failed', error: error.message });
        });
      res.status(202).json({ ok: true, reconcile_id: jobId, status: 'pending' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Reconciliation job not found' } });
    }
    res.json({ ok: true, ...job });
  });

  router.get('/:jobId/report', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.status !== 'completed' || !job.result) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_READY', message: 'Report not available yet' } });
    }
    res.json({ ok: true, report: job.result });
  });

  return router;
}
