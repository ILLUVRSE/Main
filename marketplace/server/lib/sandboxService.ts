import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import auditWriter from './auditWriter';
import jobService from './jobService';

type SandboxStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'deleted';

interface SandboxRecord {
  id: string;
  name: string;
  ownerId?: string;
  status: SandboxStatus;
  config?: Record<string, any>;
  lastRunResult?: { success: boolean; output?: string; ts: string } | null;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const SANDBOX_FILE = path.join(DATA_DIR, 'sandboxes.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('sandboxService.ensureDataDir.failed', { err });
  }
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file, { encoding: 'utf-8' });
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
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
    logger.error('sandboxService.writeJsonFile.failed', { err, file });
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function loadSandboxes(): Promise<SandboxRecord[]> {
  return await readJsonFile<SandboxRecord[]>(SANDBOX_FILE, []);
}

async function saveSandboxes(items: SandboxRecord[]) {
  await writeJsonFile(SANDBOX_FILE, items);
}

const sandboxService = {
  /**
   * List sandboxes with pagination and optional owner filter
   */
  async list(opts: { page?: number; limit?: number; ownerId?: string } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(500, Number(opts.limit ?? 25)));
    const ownerId = opts.ownerId ? String(opts.ownerId) : undefined;

    const items = await loadSandboxes();
    let filtered = items.slice().filter((s) => s.status !== 'deleted');
    if (ownerId) filtered = filtered.filter((s) => s.ownerId === ownerId);

    const total = filtered.length;
    const start = (page - 1) * limit;
    const pageItems = filtered.slice(start, start + limit);
    return { total, items: pageItems };
  },

  async getById(id: string) {
    const items = await loadSandboxes();
    return items.find((s) => s.id === id && s.status !== 'deleted') || null;
  },

  /**
   * Create a sandbox record
   */
  async create(opts: { name: string; ownerId?: string; config?: Record<string, any> }) {
    if (!opts || typeof opts.name !== 'string' || !opts.name.trim()) {
      throw new Error('name is required');
    }
    const items = await loadSandboxes();
    const id = uuidv4();
    const now = nowIso();
    const rec: SandboxRecord = {
      id,
      name: opts.name.trim(),
      ownerId: opts.ownerId,
      status: 'idle',
      config: opts.config || {},
      lastRunResult: null,
      createdAt: now,
      updatedAt: now,
    };
    items.push(rec);
    await saveSandboxes(items);

    await auditWriter.write({
      actor: opts.ownerId || 'system',
      action: 'sandbox.create',
      details: { sandboxId: id, name: rec.name },
    });

    return rec;
  },

  /**
   * Update sandbox metadata / config
   */
  async update(id: string, changes: { name?: string; config?: Record<string, any> }) {
    const items = await loadSandboxes();
    const idx = items.findIndex((s) => s.id === id && s.status !== 'deleted');
    if (idx === -1) return null;
    const s = items[idx];
    if (typeof changes.name === 'string' && changes.name.trim()) s.name = changes.name.trim();
    if (typeof changes.config === 'object' && changes.config !== null) s.config = { ...(s.config || {}), ...changes.config };
    s.updatedAt = nowIso();
    items[idx] = s;
    await saveSandboxes(items);

    await auditWriter.write({
      actor: s.ownerId || 'system',
      action: 'sandbox.update',
      details: { sandboxId: id, changes: Object.keys(changes) },
    });

    return s;
  },

  /**
   * Soft-delete (mark deleted) sandbox
   */
  async delete(id: string, opts: { actor?: string } = {}) {
    const items = await loadSandboxes();
    const idx = items.findIndex((s) => s.id === id && s.status !== 'deleted');
    if (idx === -1) return null;
    items[idx].status = 'deleted';
    items[idx].updatedAt = nowIso();
    await saveSandboxes(items);

    await auditWriter.write({
      actor: opts.actor || items[idx].ownerId || 'admin',
      action: 'sandbox.delete',
      details: { sandboxId: id },
    });

    return true;
  },

  /**
   * Run a sandbox. For the simple implementation we create a background job and
   * update sandbox status. The job payload includes sandboxId and config.
   *
   * Returns the created job descriptor.
   */
  async runSandbox(id: string, opts: { initiatedBy?: string; timeoutSeconds?: number } = {}) {
    const items = await loadSandboxes();
    const idx = items.findIndex((s) => s.id === id && s.status !== 'deleted');
    if (idx === -1) return null;
    const s = items[idx];

    // Mark as running
    s.status = 'running';
    s.updatedAt = nowIso();
    await saveSandboxes(items);

    // Create a job which will simulate running the sandbox
    const job = await jobService.triggerJob({
      kind: 'sandbox.run',
      payload: { sandboxId: id, config: s.config || {}, timeoutSeconds: Number(opts.timeoutSeconds ?? 60) },
      priority: 0,
      initiatedBy: opts.initiatedBy || s.ownerId || 'system',
      maxAttempts: 1,
    });

    // Fire-and-forget: run the simulated job immediately (dev-only synchronous run)
    (async () => {
      try {
        const result = await jobService.runJobOnce(job.id);
        const success = result.status === 'succeeded';
        const output = `Job ${result.id} finished with status ${result.status}`;
        // update sandbox lastRunResult
        const current = await loadSandboxes();
        const i = current.findIndex((x) => x.id === id);
        if (i !== -1) {
          current[i].status = success ? 'succeeded' : 'failed';
          current[i].lastRunResult = { success, output, ts: nowIso() };
          current[i].updatedAt = nowIso();
          await saveSandboxes(current);
        }
        await auditWriter.write({
          actor: opts.initiatedBy || s.ownerId || 'system',
          action: 'sandbox.run.completed',
          details: { sandboxId: id, jobId: job.id, success, output },
        });
      } catch (err) {
        logger.error('sandboxService.runSandbox.worker_failed', { err, sandboxId: id, jobId: job.id });
        // mark sandbox failed
        const current = await loadSandboxes();
        const i = current.findIndex((x) => x.id === id);
        if (i !== -1) {
          current[i].status = 'failed';
          current[i].lastRunResult = { success: false, output: 'internal error', ts: nowIso() };
          current[i].updatedAt = nowIso();
          await saveSandboxes(current);
        }
        await auditWriter.write({
          actor: opts.initiatedBy || s.ownerId || 'system',
          action: 'sandbox.run.failed',
          details: { sandboxId: id, jobId: job.id, error: String(err) },
        });
      }
    })();

    await auditWriter.write({
      actor: opts.initiatedBy || s.ownerId || 'system',
      action: 'sandbox.run.started',
      details: { sandboxId: id, jobId: job.id },
    });

    return job;
  },

  /**
   * Cleanup sandbox resources. For disk-backed sandboxes there may be little to clean,
   * but this method records audit events and marks sandbox as deleted.
   */
  async cleanupSandbox(id: string, opts: { actor?: string } = {}) {
    const items = await loadSandboxes();
    const idx = items.findIndex((s) => s.id === id && s.status !== 'deleted');
    if (idx === -1) return null;
    // perform best-effort cleanup (placeholder for detaching volumes, VMs, etc.)
    items[idx].status = 'deleted';
    items[idx].updatedAt = nowIso();
    await saveSandboxes(items);

    await auditWriter.write({
      actor: opts.actor || items[idx].ownerId || 'admin',
      action: 'sandbox.cleanup',
      details: { sandboxId: id },
    });

    return true;
  },
};

export default sandboxService;

