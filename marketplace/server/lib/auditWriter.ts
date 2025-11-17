import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';

interface AuditRecord {
  id: string;
  actor?: string;
  action: string;
  details?: Record<string, any>;
  createdAt: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUDITS_FILE = path.join(DATA_DIR, 'audits.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('auditWriter.ensureDataDir.failed', { err });
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
    logger.error('auditWriter.writeJsonFile.failed', { err, file });
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Basic text-match helper for queries
 */
function matchesQ(rec: AuditRecord, q?: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  if ((rec.action || '').toLowerCase().includes(s)) return true;
  if ((rec.actor || '').toLowerCase().includes(s)) return true;
  try {
    const details = JSON.stringify(rec.details || {});
    if (details.toLowerCase().includes(s)) return true;
  } catch {
    // ignore serialization errors
  }
  return false;
}

const auditWriter = {
  /**
   * Write a new audit entry.
   * Accepts { actor?: string, action: string, details?: object }
   */
  async write(entry: { actor?: string; action: string; details?: Record<string, any> }) {
    if (!entry || typeof entry.action !== 'string') {
      throw new Error('invalid audit entry');
    }
    try {
      const items = await readJsonFile<AuditRecord[]>(AUDITS_FILE, []);
      const rec: AuditRecord = {
        id: uuidv4(),
        actor: entry.actor,
        action: entry.action,
        details: entry.details || {},
        createdAt: nowIso(),
      };
      items.push(rec);
      await writeJsonFile(AUDITS_FILE, items);
      return rec;
    } catch (err) {
      logger.error('auditWriter.write.failed', { err, entry });
      throw err;
    }
  },

  /**
   * Query audit entries. Options:
   * { page, limit, filter: { q, actor, action, since, until } }
   */
  async query(opts: {
    page?: number;
    limit?: number;
    filter?: { q?: string; actor?: string; action?: string; since?: string; until?: string };
  } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(5000, Number(opts.limit ?? 100)));
    const filter = opts.filter || {};
    const q = filter.q ? String(filter.q) : undefined;
    const actor = filter.actor ? String(filter.actor) : undefined;
    const action = filter.action ? String(filter.action) : undefined;
    const since = filter.since ? new Date(String(filter.since)) : undefined;
    const until = filter.until ? new Date(String(filter.until)) : undefined;

    try {
      const items = await readJsonFile<AuditRecord[]>(AUDITS_FILE, []);
      let filtered = items.slice().reverse(); // latest first

      if (q) filtered = filtered.filter((r) => matchesQ(r, q));
      if (actor) filtered = filtered.filter((r) => (r.actor || '') === actor);
      if (action) filtered = filtered.filter((r) => (r.action || '') === action);
      if (since && !Number.isNaN(since.getTime())) filtered = filtered.filter((r) => new Date(r.createdAt) >= since);
      if (until && !Number.isNaN(until.getTime())) filtered = filtered.filter((r) => new Date(r.createdAt) <= until);

      const total = filtered.length;
      const start = (page - 1) * limit;
      const pageItems = filtered.slice(start, start + limit);

      return { total, items: pageItems };
    } catch (err) {
      logger.error('auditWriter.query.failed', { err, opts });
      throw err;
    }
  },

  /**
   * Get an audit entry by id.
   */
  async getById(id: string) {
    if (!id) return null;
    try {
      const items = await readJsonFile<AuditRecord[]>(AUDITS_FILE, []);
      return items.find((r) => r.id === id) || null;
    } catch (err) {
      logger.error('auditWriter.getById.failed', { err, id });
      return null;
    }
  },

  /**
   * Delete an audit entry by id (permanent).
   */
  async deleteById(id: string) {
    if (!id) return false;
    try {
      const items = await readJsonFile<AuditRecord[]>(AUDITS_FILE, []);
      const idx = items.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      items.splice(idx, 1);
      await writeJsonFile(AUDITS_FILE, items);
      return true;
    } catch (err) {
      logger.error('auditWriter.deleteById.failed', { err, id });
      throw err;
    }
  },

  /**
   * Purge audit entries older than cutoffIso (ISO timestamp string). Returns number deleted.
   */
  async purgeOlderThan(cutoffIso: string) {
    try {
      const cutoff = new Date(cutoffIso).getTime();
      if (Number.isNaN(cutoff)) throw new Error('invalid cutoffIso');
      const items = await readJsonFile<AuditRecord[]>(AUDITS_FILE, []);
      const before = items.length;
      const remaining = items.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
      const deleted = before - remaining.length;
      await writeJsonFile(AUDITS_FILE, remaining);
      logger.info('auditWriter.purged', { cutoffIso, deleted });
      return deleted;
    } catch (err) {
      logger.error('auditWriter.purgeOlderThan.failed', { err, cutoffIso });
      throw err;
    }
  },
};

export default auditWriter;

