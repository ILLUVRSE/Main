import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import auditWriter from './auditWriter';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface JobHistory {
  ts: string;
  status: JobStatus;
  note?: string;
}

interface JobLog {
  ts: string;
  level?: 'info' | 'warn' | 'error' | 'debug';
  msg: string;
  meta?: Record<string, any>;
}

interface JobRecord {
  id: string;
  kind: string;
  payload?: Record<string, any>;
  priority: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  history?: JobHistory[];
  logs?: JobLog[];
  initiatedBy?: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('jobService.ensureDataDir.failed', { err });
  }
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file, { encoding: 'utf-8' });
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: any) {
  try {
    await ensureDataDir();
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
    await fs.promises.rename(tmp, file);
  } catch (err) {
    logger.error('jobService.writeJsonFile.failed', { err, file });
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function loadJobs(): Promise<JobRecord[]> {
  return await readJsonFile<JobRecord[]>(JOBS_FILE, []);
}

async function saveJobs(jobs: JobRecord[]) {
  await writeJsonFile(JOBS_FILE, jobs);
}

const jobService = {
  /**
   * Trigger a new job. Returns job descriptor.
   */
  async triggerJob(opts: {
    kind: string;
    payload?: Record<string, any>;
    priority?: number;
    initiatedBy?: string;
    maxAttempts?: number;
  }) {
    const jobs = await loadJobs();
    const id = uuidv4();
    const now = nowIso();
    const rec: JobRecord = {
      id,
      kind: opts.kind,
      payload: opts.payload || {},
      priority: Number(opts.priority ?? 0),
      status: 'queued',
      attempts: 0,
      maxAttempts: Number(opts.maxAttempts ?? 3),
      createdAt: now,
      updatedAt: now,
      history: [{ ts: now, status: 'queued', note: 'created' }],
      logs: [],
      initiatedBy: opts.initiatedBy,
    };
    jobs.push(rec);
    await saveJobs(jobs);

    await auditWriter.write({
      actor: opts.initiatedBy || 'system',
      action: 'job.trigger',
      details: { jobId: id, kind: opts.kind, priority: rec.priority },
    });

    return rec;
  },

  /**
   * List jobs with filters and pagination.
   */
  async listJobs(opts: {
    q?: string;
    page?: number;
    limit?: number;
    status?: string;
    kind?: string;
    worker?: string;
  } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(500, Number(opts.limit ?? 25)));
    const q = opts.q ? String(opts.q).toLowerCase() : undefined;
    const status = opts.status ? String(opts.status) : undefined;
    const kind = opts.kind ? String(opts.kind) : undefined;

    const jobs = await loadJobs();
    let filtered = jobs.slice();

    if (status) filtered = filtered.filter((j) => j.status === status);
    if (kind) filtered = filtered.filter((j) => j.kind === kind);
    if (q) {
      filtered = filtered.filter(
        (j) =>
          j.id.toLowerCase().includes(q) ||
          j.kind.toLowerCase().includes(q) ||
          JSON.stringify(j.payload || {}).toLowerCase().includes(q)
      );
    }

    // sort by priority desc then createdAt asc
    filtered.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.createdAt > b.createdAt ? 1 : -1;
    });

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);
    return { total, items };
  },

  /**
   * Get a single job. Options to include logs/history are honored (they are part of record).
   */
  async getJob(id: string, opts: { includeLogs?: boolean; includeHistory?: boolean } = {}) {
    const jobs = await loadJobs();
    const j = jobs.find((x) => x.id === id);
    if (!j) return null;
    // Clone and optionally omit logs/history
    const copy: any = { ...j };
    if (!opts.includeLogs) copy.logs = undefined;
    if (!opts.includeHistory) copy.history = undefined;
    return copy;
  },

  /**
   * Retry a failed or stalled job. Optionally set attemptDelaySeconds (ignored in this simple impl).
   */
  async retryJob(id: string, opts: { attemptDelaySeconds?: number; actor?: string } = {}) {
    const jobs = await loadJobs();
    const idx = jobs.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const job = jobs[idx];

    if (job.status !== 'failed' && job.status !== 'cancelled' && job.status !== 'queued' && job.status !== 'running') {
      // Allow retries only for failed/cancelled/queued/running for flexibility
      return null;
    }

    if (job.attempts >= job.maxAttempts) {
      logger.warn('jobService.retryJob.maxAttempts', { jobId: id, attempts: job.attempts, max: job.maxAttempts });
      return null;
    }

    job.status = 'queued';
    job.attempts = Math.max(0, job.attempts);
    job.updatedAt = nowIso();
    job.history = job.history || [];
    job.history.push({ ts: job.updatedAt, status: 'queued', note: `retried by ${opts.actor || 'system'}` });

    jobs[idx] = job;
    await saveJobs(jobs);

    await auditWriter.write({
      actor: opts.actor || 'system',
      action: 'job.retry',
      details: { jobId: id },
    });

    return job;
  },

  /**
   * Cancel a running or queued job.
   */
  async cancelJob(id: string, opts: { reason?: string; force?: boolean; actor?: string } = {}) {
    const jobs = await loadJobs();
    const idx = jobs.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const job = jobs[idx];

    if (job.status === 'succeeded' || job.status === 'failed') {
      // cannot cancel finished jobs
      return null;
    }

    job.status = 'cancelled';
    job.updatedAt = nowIso();
    job.history = job.history || [];
    job.history.push({ ts: job.updatedAt, status: 'cancelled', note: opts.reason || 'cancelled by user' });
    job.finishedAt = job.updatedAt;

    jobs[idx] = job;
    await saveJobs(jobs);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'job.cancel',
      details: { jobId: id, reason: opts.reason || '', force: Boolean(opts.force) },
    });

    return job;
  },

  /**
   * Delete job record permanently.
   */
  async deleteJob(id: string, opts: { actor?: string } = {}) {
    const jobs = await loadJobs();
    const idx = jobs.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    jobs.splice(idx, 1);
    await saveJobs(jobs);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'job.delete',
      details: { jobId: id },
    });

    return true;
  },

  /**
   * Purge jobs older than cutoffIso and optionally matching a status.
   */
  async purgeJobs(opts: { cutoffIso: string; status?: string; actor?: string } = { cutoffIso: new Date(0).toISOString() }) {
    const cutoff = new Date(opts.cutoffIso).getTime();
    if (Number.isNaN(cutoff)) return 0;
    const jobs = await loadJobs();
    const beforeCount = jobs.length;
    const remaining = jobs.filter((j) => {
      const updated = new Date(j.updatedAt).getTime();
      if (opts.status && j.status !== opts.status) return true;
      return !(updated < cutoff);
    });
    const deletedCount = beforeCount - remaining.length;
    await saveJobs(remaining);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'job.purge',
      details: { cutoffIso: opts.cutoffIso, status: opts.status, deletedCount },
    });

    return deletedCount;
  },

  /**
   * Append a log entry to a job.
   */
  async appendLog(jobId: string, entry: { level?: 'info' | 'warn' | 'error' | 'debug'; msg: string; meta?: Record<string, any> }) {
    const jobs = await loadJobs();
    const idx = jobs.findIndex((x) => x.id === jobId);
    if (idx === -1) return null;
    const j = jobs[idx];
    j.logs = j.logs || [];
    const log: JobLog = { ts: nowIso(), level: entry.level || 'info', msg: entry.msg, meta: entry.meta };
    j.logs.push(log);
    j.updatedAt = nowIso();
    await saveJobs(jobs);
    return log;
  },

  /**
   * Simulated worker step - mark job as running then succeed/fail based on simple heuristics.
   * For tests/dev only. Not exposed via routes by default.
   */
  async runJobOnce(jobId: string) {
    const jobs = await loadJobs();
    const idx = jobs.findIndex((x) => x.id === jobId);
    if (idx === -1) return null;
    const j = jobs[idx];
    if (j.status === 'succeeded' || j.status === 'running') return j;

    j.status = 'running';
    j.startedAt = nowIso();
    j.attempts = (j.attempts || 0) + 1;
    j.history = j.history || [];
    j.history.push({ ts: j.startedAt, status: 'running', note: 'started' });
    j.updatedAt = nowIso();
    jobs[idx] = j;
    await saveJobs(jobs);

    // Simulate processing
    try {
      // simple heuristic: succeed if attempts < maxAttempts or random
      const shouldSucceed = j.attempts <= j.maxAttempts;
      if (shouldSucceed) {
        j.status = 'succeeded';
        j.finishedAt = nowIso();
        j.history.push({ ts: j.finishedAt, status: 'succeeded', note: 'completed' });
      } else {
        j.status = 'failed';
        j.finishedAt = nowIso();
        j.history.push({ ts: j.finishedAt, status: 'failed', note: 'max attempts exceeded' });
      }
      j.updatedAt = nowIso();
      jobs[idx] = j;
      await saveJobs(jobs);

      await auditWriter.write({
        actor: 'system',
        action: 'job.run.completed',
        details: { jobId: j.id, status: j.status },
      });
      return j;
    } catch (err) {
      logger.error('jobService.runJobOnce.failed', { err, jobId });
      j.status = 'failed';
      j.updatedAt = nowIso();
      j.history.push({ ts: j.updatedAt, status: 'failed', note: 'exception' });
      jobs[idx] = j;
      await saveJobs(jobs);
      return j;
    }
  },

  /**
   * Return job system statistics.
   */
  async getStats() {
    const jobs = await loadJobs();
    const byStatus: Record<string, number> = {};
    for (const j of jobs) {
      byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    }
    // queue length for queued status
    const queueLength = byStatus['queued'] || 0;
    // recent failures
    const recentFailures = jobs
      .filter((j) => j.status === 'failed')
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
      .slice(0, 10)
      .map((j) => ({ id: j.id, kind: j.kind, updatedAt: j.updatedAt, attempts: j.attempts, maxAttempts: j.maxAttempts }));

    return { totalJobs: jobs.length, byStatus, queueLength, recentFailures };
  },
};

export default jobService;

