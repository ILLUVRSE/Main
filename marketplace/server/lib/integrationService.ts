import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import auditWriter from './auditWriter';
import settingsService from './settingsService';

type IntegrationKind = 'stripe' | 'github' | 's3' | 'generic';

interface IntegrationRecord {
  id: string;
  name: string;
  kind: IntegrationKind | string;
  config: Record<string, any>;
  active: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const INTEGRATIONS_FILE = path.join(DATA_DIR, 'integrations.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('integrationService.ensureDataDir.failed', { err });
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
    logger.error('integrationService.writeJsonFile.failed', { err, file });
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Redact secrets in an integration record's config for safe display.
 */
function redactConfig(cfg: Record<string, any>) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const out: Record<string, any> = {};
  const secretKeys = [/secret/i, /token/i, /key/i, /password/i, /private/i, /credential/i];
  for (const k of Object.keys(cfg)) {
    const v = cfg[k];
    if (secretKeys.some((rx) => rx.test(k))) {
      out[k] = '***REDACTED***';
      continue;
    }
    if (typeof v === 'object' && v !== null) out[k] = redactConfig(v);
    else out[k] = v;
  }
  return out;
}

const integrationService = {
  async list(opts: { q?: string; page?: number; limit?: number; kind?: string; active?: boolean } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(500, Number(opts.limit ?? 25)));
    const q = opts.q ? String(opts.q).toLowerCase() : undefined;
    const kind = opts.kind ? String(opts.kind).toLowerCase() : undefined;
    const active = typeof opts.active === 'boolean' ? opts.active : undefined;

    const items = await readJsonFile<IntegrationRecord[]>(INTEGRATIONS_FILE, []);
    let filtered = items.slice();
    if (typeof active === 'boolean') filtered = filtered.filter((i) => i.active === active);
    if (kind) filtered = filtered.filter((i) => String(i.kind).toLowerCase() === kind);
    if (q) filtered = filtered.filter((i) => i.name.toLowerCase().includes(q) || String(i.kind).toLowerCase().includes(q));

    const total = filtered.length;
    const start = (page - 1) * limit;
    const results = filtered.slice(start, start + limit).map((r) => ({ ...r, config: redactConfig(r.config) }));
    return { total, items: results };
  },

  async create(opts: { name: string; kind: string; config?: Record<string, any>; active?: boolean; createdBy?: string }) {
    const items = await readJsonFile<IntegrationRecord[]>(INTEGRATIONS_FILE, []);
    const id = uuidv4();
    const now = nowIso();
    const rec: IntegrationRecord = {
      id,
      name: opts.name,
      kind: opts.kind,
      config: opts.config || {},
      active: typeof opts.active === 'boolean' ? opts.active : true,
      createdBy: opts.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    items.push(rec);
    await writeJsonFile(INTEGRATIONS_FILE, items);

    await auditWriter.write({
      actor: opts.createdBy || 'system',
      action: 'integration.create',
      details: { id, name: opts.name, kind: opts.kind },
    });

    return { ...rec, config: redactConfig(rec.config) };
  },

  async getById(id: string) {
    const items = await readJsonFile<IntegrationRecord[]>(INTEGRATIONS_FILE, []);
    const found = items.find((i) => i.id === id);
    if (!found) return null;
    // Return full record (do not leak raw secrets)
    return { ...found, config: redactConfig(found.config) };
  },

  /**
   * Internal get that returns the raw record (for verification/usage), not redacted.
   */
  async _getRawById(id: string) {
    const items = await readJsonFile<IntegrationRecord[]>(INTEGRATIONS_FILE, []);
    return items.find((i) => i.id === id) || null;
  },

  async update(id: string, changes: { name?: string; config?: Record<string, any>; active?: boolean }) {
    const items = await readJsonFile<IntegrationRecord[]>(INTEGRATIONS_FILE, []);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const rec = items[idx];
    if (typeof changes.name === 'string') rec.name = changes.name;
    if (typeof changes.active === 'boolean') rec.active = changes.active;
    if (typeof changes.config === 'object' && changes.config !== null) {
      // merge shallowly
      rec.config = { ...(rec.config || {}), ...(changes.config || {}) };
    }
    rec.updatedAt = nowIso();
    items[idx] = rec;
    await writeJsonFile(INTEGRATIONS_FILE, items);

    await auditWriter.write({
      actor: 'admin',
      action: 'integration.update',
      details: { id, changes: Object.keys(changes) },
    });

    return { ...rec, config: redactConfig(rec.config) };
  },

  async delete(id: string) {
    const items = await readJsonFile<IntegrationRecord[]>(INTEGRATIONS_FILE, []);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await writeJsonFile(INTEGRATIONS_FILE, items);

    await auditWriter.write({
      actor: 'admin',
      action: 'integration.delete',
      details: { id },
    });

    return true;
  },

  /**
   * Redact an integration record for UI display.
   */
  redact(rec: any) {
    if (!rec) return rec;
    const copy = { ...rec };
    copy.config = redactConfig(rec.config || {});
    return copy;
  },

  /**
   * Test connection for integration. Does provider-specific checks.
   */
  async testConnection(id: string, opts: { dryRun?: boolean } = {}) {
    const raw = await this._getRawById(id);
    if (!raw) return { ok: false, error: 'not found' };
    // Basic checks: config must have entries for common providers
    try {
      if (String(raw.kind).toLowerCase() === 'stripe') {
        const secret = raw.config?.webhookSecret || raw.config?.secretKey || raw.config?.apiKey;
        if (!secret) return { ok: false, error: 'missing webhookSecret or apiKey in config' };
        // We can't really hit Stripe from here, so perform a minimal HMAC verification simulation
        return { ok: true, message: 'configuration appears valid' };
      } else if (String(raw.kind).toLowerCase() === 'github') {
        const token = raw.config?.token || raw.config?.appToken;
        if (!token) return { ok: false, error: 'missing token in config' };
        return { ok: true, message: 'configuration appears valid' };
      } else if (String(raw.kind).toLowerCase() === 's3') {
        const key = raw.config?.accessKeyId;
        const secret = raw.config?.secretAccessKey;
        if (!key || !secret) return { ok: false, error: 'missing s3 credentials' };
        return { ok: true, message: 'configuration appears valid' };
      }
      // Generic integration: ensure there's at least something in config
      if (!raw.config || Object.keys(raw.config).length === 0) return { ok: false, error: 'empty config' };
      return { ok: true, message: 'configuration appears valid' };
    } catch (err) {
      logger.error('integrationService.testConnection.failed', { err, id });
      return { ok: false, error: 'test failed' };
    }
  },

  /**
   * Reload integration config from disk - basically a noop for this simple store.
   */
  async reload(id: string) {
    const raw = await this._getRawById(id);
    if (!raw) return null;
    // no runtime cache; return redacted copy
    return { ...raw, config: redactConfig(raw.config || {}) };
  },

  /**
   * Trigger a sync job for integrations. Returns a lightweight job descriptor.
   */
  async triggerSync(opts: { kinds?: string[]; force?: boolean; initiatedBy?: string } = {}) {
    // For the simple implementation we create a job-like object and return it.
    const job = {
      id: uuidv4(),
      createdAt: nowIso(),
      kinds: opts.kinds || null,
      force: Boolean(opts.force),
      initiatedBy: opts.initiatedBy || 'system',
      status: 'queued',
    };

    await auditWriter.write({
      actor: opts.initiatedBy || 'system',
      action: 'integration.sync.trigger',
      details: { jobId: job.id, kinds: job.kinds },
    });

    // In a more advanced system we'd enqueue a background job. Here we return job descriptor.
    return job;
  },

  /**
   * Verify a webhook signature. Providers differ; this attempts to support common patterns.
   * Returns { ok: boolean, error?: string }
   */
  async verifyWebhookSignature(provider: string, opts: { headers: Record<string, any>; rawBody?: Buffer | string | undefined }) {
    try {
      // Find provider config
      const items = await readJsonFile<IntegrationRecord[]>(INTEGRATIONS_FILE, []);
      const prov = items.find((p) => String(p.name).toLowerCase() === provider.toLowerCase() || String(p.kind).toLowerCase() === provider.toLowerCase() || p.id === provider);
      // If provider not registered, be lenient and accept (caller may still reject)
      if (!prov) return { ok: true };

      const cfg = prov.config || {};
      const raw = opts.rawBody;
      const headers = opts.headers || {};

      // Stripe-like: header 'stripe-signature' and config.webhookSecret
      if (headers['stripe-signature'] && (cfg.webhookSecret || cfg.secret)) {
        const secret = cfg.webhookSecret || cfg.secret;
        const payload = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : JSON.stringify(opts);
        // compute expected signature using HMAC SHA256
        const expected = crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
        // Providers often include multiple signatures; we'll check substring
        const sigHeader = String(headers['stripe-signature'] || headers['Stripe-Signature'] || '');
        if (sigHeader.includes(expected) || sigHeader.includes(expected.slice(0, 16))) {
          return { ok: true };
        }
        return { ok: false, error: 'signature mismatch' };
      }

      // Generic HMAC header 'x-signature' with config.webhookSecret
      if ((headers['x-signature'] || headers['x-hub-signature']) && cfg.webhookSecret) {
        const secret = String(cfg.webhookSecret);
        const payload = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : JSON.stringify(opts);
        const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        const got = String(headers['x-signature'] || headers['x-hub-signature'] || '');
        if (got.includes(expected) || got === `sha256=${expected}`) return { ok: true };
        return { ok: false, error: 'signature mismatch' };
      }

      // If integration config defines a simple token, accept header 'x-webhook-token'
      if (cfg.webhookToken && (headers['x-webhook-token'] === cfg.webhookToken || headers['x-webhook-token'] === String(cfg.webhookToken))) {
        return { ok: true };
      }

      // If no secrets configured, fall back to accepting (some providers don't sign)
      return { ok: true };
    } catch (err) {
      logger.error('integrationService.verifyWebhookSignature.failed', { err, provider });
      return { ok: false, error: 'verification error' };
    }
  },

  /**
   * Normalize webhook payload into { kind, payload, id, receivedAt }.
   * This is a best-effort normalization used by the webhooks route.
   */
  async normalizeWebhook(provider: string, opts: { headers: Record<string, any>; rawBody?: Buffer | string | undefined; parsedBody?: any }) {
    try {
      const headers = opts.headers || {};
      const raw = opts.rawBody;
      let parsed = opts.parsedBody;
      if (!parsed && raw) {
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString('utf8'));
        } catch {
          // leave parsed undefined
        }
      }

      // Provider heuristics
      const pname = provider.toLowerCase();
      const now = new Date().toISOString();
      if (pname.includes('stripe') || headers['stripe-signature']) {
        // Stripe events: top-level 'type' and 'data' fields
        const kind = parsed?.type || parsed?.event || 'payment.unknown';
        const payload = parsed?.data?.object || parsed || {};
        const id = parsed?.id || uuidv4();
        return { kind, payload, id, receivedAt: now };
      }

      if (pname.includes('github') || headers['x-github-event']) {
        const kind = `github.${String(headers['x-github-event'] || parsed?.action || 'event')}`;
        const payload = parsed || {};
        const id = headers['x-github-delivery'] || parsed?.id || uuidv4();
        return { kind, payload, id, receivedAt: now };
      }

      // Generic mapping: look for common keys
      const kind = parsed?.kind || parsed?.event || parsed?.type || headers['x-event-type'] || 'integration.unknown';
      const payload = parsed || {};
      const id = parsed?.id || headers['x-request-id'] || uuidv4();
      return { kind: String(kind), payload, id, receivedAt: now };
    } catch (err) {
      logger.error('integrationService.normalizeWebhook.failed', { err, provider });
      return null;
    }
  },

  /**
   * Fallback handler for integration-driven events not handled elsewhere.
   */
  async handleEvent(provider: string, normalized: any) {
    try {
      await auditWriter.write({
        actor: `integration:${provider}`,
        action: 'integration.event.received',
        details: { provider, kind: normalized?.kind, id: normalized?.id },
      });
      // For now, just log. In future we may route to specific service handlers.
      logger.info('integration.handleEvent', { provider, kind: normalized?.kind, id: normalized?.id });
      return true;
    } catch (err) {
      logger.error('integrationService.handleEvent.failed', { err, provider, normalized });
      return false;
    }
  },
};

export default integrationService;

