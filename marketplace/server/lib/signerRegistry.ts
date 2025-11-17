/**
 * signerRegistry.ts
 *
 * Simple disk-backed signer registry used to manage signer entries for agents and
 * other components. Each signer holds a small piece of secret material which can
 * be used to produce HMAC signatures for provisioning or verification.
 *
 * NOTE: This implementation stores secrets on disk in plaintext for development only.
 * In production you MUST use a secure KMS/HSM and never persist secrets unencrypted.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import auditWriter from './auditWriter';

type SignerKind = 'hmac' | 'generic';

interface SignerRecord {
  id: string;
  name: string;
  kind: SignerKind | string;
  secret?: string | null; // development-only secret material
  metadata?: Record<string, any>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const SIGNERS_FILE = path.join(DATA_DIR, 'signers.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('signerRegistry.ensureDataDir.failed', { err });
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
    logger.error('signerRegistry.writeJsonFile.failed', { err, file });
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Utility to create a new random secret (dev only)
 */
function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Load / save helpers
 */
async function loadSigners(): Promise<SignerRecord[]> {
  return await readJsonFile<SignerRecord[]>(SIGNERS_FILE, []);
}

async function saveSigners(items: SignerRecord[]) {
  await writeJsonFile(SIGNERS_FILE, items);
}

/**
 * Public API
 */
const signerRegistry = {
  /**
   * List signers with optional filters q/page/limit
   */
  async list(opts: { q?: string; page?: number; limit?: number; active?: boolean } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(500, Number(opts.limit ?? 25)));
    const q = opts.q ? String(opts.q).toLowerCase() : undefined;
    const activeFilter = typeof opts.active === 'boolean' ? opts.active : undefined;

    const items = await loadSigners();
    let filtered = items.slice();

    if (typeof activeFilter === 'boolean') filtered = filtered.filter((s) => s.active === activeFilter);
    if (q) filtered = filtered.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));

    const total = filtered.length;
    const start = (page - 1) * limit;
    const pageItems = filtered.slice(start, start + limit).map((r) => {
      // Redact secret for listing
      const copy = { ...r };
      if (copy.secret) copy.secret = '***REDACTED***';
      return copy;
    });

    return { total, items: pageItems };
  },

  /**
   * Create a signer record. If secret is not provided, a random secret is generated.
   */
  async create(opts: { name: string; kind?: SignerKind | string; secret?: string; metadata?: Record<string, any>; createdBy?: string }) {
    if (!opts || typeof opts.name !== 'string' || !opts.name.trim()) {
      throw new Error('name is required');
    }
    const items = await loadSigners();
    const id = uuidv4();
    const now = nowIso();
    const secret = opts.secret || generateSecret();

    const rec: SignerRecord = {
      id,
      name: opts.name.trim(),
      kind: (opts.kind as string) || 'hmac',
      secret,
      metadata: opts.metadata || {},
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: opts.createdBy,
    };

    items.push(rec);
    await saveSigners(items);

    await auditWriter.write({
      actor: opts.createdBy || 'system',
      action: 'signer.create',
      details: { signerId: id, name: rec.name, kind: rec.kind },
    });

    // Return redacted record but include secret for admin provisioning
    const out = { ...rec, secret: '***REDACTED***' };
    return { record: out, secret: rec.secret };
  },

  /**
   * Get a signer (redacted secret by default). Pass { raw: true } to get secret.
   */
  async getSignerById(id: string, opts: { raw?: boolean } = {}) {
    if (!id) return null;
    const items = await loadSigners();
    const found = items.find((s) => s.id === id);
    if (!found) return null;
    if (opts.raw) return found;
    const copy = { ...found, secret: found.secret ? '***REDACTED***' : null };
    return copy;
  },

  /**
   * Update signer metadata or rotate secret.
   * changes: { name?, metadata?, active?, rotateSecret?: boolean, secret?: string }
   */
  async update(id: string, changes: { name?: string; metadata?: Record<string, any>; active?: boolean; rotateSecret?: boolean; secret?: string; updatedBy?: string }) {
    const items = await loadSigners();
    const idx = items.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const rec = items[idx];

    if (typeof changes.name === 'string' && changes.name.trim()) rec.name = changes.name.trim();
    if (typeof changes.metadata === 'object' && changes.metadata !== null) rec.metadata = { ...(rec.metadata || {}), ...changes.metadata };
    if (typeof changes.active === 'boolean') rec.active = changes.active;

    if (changes.rotateSecret) {
      rec.secret = generateSecret();
    } else if (typeof changes.secret === 'string') {
      rec.secret = changes.secret;
    }

    rec.updatedAt = nowIso();
    items[idx] = rec;
    await saveSigners(items);

    await auditWriter.write({
      actor: changes.updatedBy || 'admin',
      action: 'signer.update',
      details: { signerId: id, changes: Object.keys(changes).filter((k) => k !== 'secret') },
    });

    // Return redacted record
    const copy = { ...rec, secret: rec.secret ? '***REDACTED***' : null };
    return copy;
  },

  /**
   * Delete a signer (hard delete)
   */
  async delete(id: string, opts: { actor?: string } = {}) {
    const items = await loadSigners();
    const idx = items.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await saveSigners(items);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'signer.delete',
      details: { signerId: id },
    });

    return true;
  },

  /**
   * Produce an HMAC signature for the given payload using the signer's secret.
   * Returns signature hex string or null if signer not found / inactive.
   *
   * For 'hmac' kind signers we use SHA256 HMAC of stringified payload.
   */
  async sign(signerId: string, payload: any, opts: { algorithm?: string } = {}) {
    const raw = await this.getSignerById(signerId, { raw: true } as any) as SignerRecord | null;
    if (!raw || !raw.active || !raw.secret) return null;

    const alg = opts.algorithm || 'sha256';
    try {
      // Stringify payload deterministically
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const hmac = crypto.createHmac(alg, raw.secret);
      hmac.update(body);
      return hmac.digest('hex');
    } catch (err) {
      logger.error('signerRegistry.sign.failed', { err, signerId });
      return null;
    }
  },

  /**
   * Verify a signature against a payload using signer's secret.
   * Returns boolean.
   */
  async verify(signerId: string, payload: any, signature: string, opts: { algorithm?: string } = {}) {
    try {
      const expected = await this.sign(signerId, payload, opts);
      if (!expected) return false;
      // Constant-time compare
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch (err) {
      logger.error('signerRegistry.verify.failed', { err, signerId });
      return false;
    }
  },
};

export default signerRegistry;

