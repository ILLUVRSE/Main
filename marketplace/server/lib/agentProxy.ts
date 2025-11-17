/**
 * agentProxy.ts
 *
 * Small disk-backed agent registry and proxy helper used by admin APIs.
 * This provides a simple implementation for listing/creating/updating/revoking
 * agents, rotating credentials, and triggering a "redeploy" action.
 *
 * Notes:
 *  - This is intentionally simple for dev/testing. In production, agents would
 *    be managed by a control plane and keys would live in a KMS/HSM.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import auditWriter from './auditWriter';
import signerRegistry from './signerRegistry';

type AgentStatus = 'active' | 'revoked' | 'pending';

interface AgentRecord {
  id: string;
  name: string;
  config?: Record<string, any>;
  signerId?: string | null;
  status: AgentStatus;
  keys?: {
    publicKey?: string | null;
    secretKey?: string | null; // note: in a real system secretKey wouldn't be stored in plaintext
    createdAt?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('agentProxy.ensureDataDir.failed', { err });
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
    logger.error('agentProxy.writeJsonFile.failed', { err, file });
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Generate a simple key pair (not real asymmetric pair) for dev/testing.
 * In production, this should call KMS/HSM or create proper crypto keypairs.
 */
function generateKeys() {
  const secret = crypto.randomBytes(32).toString('hex');
  const pub = crypto.createHash('sha256').update(secret).digest('hex');
  return { publicKey: pub, secretKey: secret, createdAt: nowIso() };
}

/**
 * Load / Save helpers
 */
async function loadAgents(): Promise<AgentRecord[]> {
  return await readJsonFile<AgentRecord[]>(AGENTS_FILE, []);
}

async function saveAgents(items: AgentRecord[]) {
  await writeJsonFile(AGENTS_FILE, items);
}

const agentProxy = {
  /**
   * List agents (simple pagination and filter)
   */
  async listAgents(opts: { q?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(1000, Number(opts.limit ?? 50)));
    const q = opts.q ? String(opts.q).toLowerCase() : undefined;

    const items = await loadAgents();
    let filtered = items.slice();

    if (q) {
      filtered = filtered.filter((a) => a.name.toLowerCase().includes(q) || (a.id || '').toLowerCase().includes(q));
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const pageItems = filtered.slice(start, start + limit);

    return { total, items: pageItems };
  },

  /**
   * Create a new agent record. signerId is optional.
   */
  async createAgent(payload: {
    id?: string;
    name: string;
    config?: Record<string, any>;
    signerId?: string | null;
    createdBy?: string;
  }) {
    const items = await loadAgents();

    // If signerId specified validate it exists
    if (typeof payload.signerId === 'string' && payload.signerId) {
      const signer = await signerRegistry.getSignerById(payload.signerId);
      if (!signer) {
        throw new Error(`signer ${payload.signerId} not found`);
      }
    }

    const id = payload.id || uuidv4();
    const now = nowIso();
    const keys = generateKeys();

    const rec: AgentRecord = {
      id,
      name: payload.name,
      config: payload.config || {},
      signerId: payload.signerId ?? null,
      status: 'active',
      keys: {
        publicKey: keys.publicKey,
        secretKey: keys.secretKey,
        createdAt: keys.createdAt,
      },
      createdAt: now,
      updatedAt: now,
      createdBy: payload.createdBy,
    };

    items.push(rec);
    await saveAgents(items);

    await auditWriter.write({
      actor: payload.createdBy || 'system',
      action: 'agent.create',
      details: { agentId: id, name: payload.name },
    });

    // Do not return secretKey in production APIs, but admin routes may use it for provisioning.
    return rec;
  },

  async getAgent(id: string) {
    const items = await loadAgents();
    return items.find((a) => a.id === id) || null;
  },

  async updateAgent(id: string, changes: Partial<Omit<AgentRecord, 'id' | 'createdAt'>>) {
    const items = await loadAgents();
    const idx = items.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    const rec = items[idx];

    if (typeof changes.name === 'string') rec.name = changes.name;
    if (typeof changes.config === 'object') rec.config = { ...(rec.config || {}), ...(changes.config || {}) };
    if (typeof (changes as any).signerId !== 'undefined') {
      // allow null to detach signer
      const signerIdCandidate = (changes as any).signerId;
      if (signerIdCandidate) {
        const signer = await signerRegistry.getSignerById(String(signerIdCandidate));
        if (!signer) throw new Error(`signer ${signerIdCandidate} not found`);
        rec.signerId = String(signerIdCandidate);
      } else {
        rec.signerId = null;
      }
    }

    rec.updatedAt = nowIso();
    items[idx] = rec;
    await saveAgents(items);

    await auditWriter.write({
      actor: (changes as any).updatedBy || 'system',
      action: 'agent.update',
      details: { agentId: id, changes: Object.keys(changes) },
    });

    return rec;
  },

  async revokeAgent(id: string) {
    const items = await loadAgents();
    const idx = items.findIndex((a) => a.id === id && a.status !== 'revoked');
    if (idx === -1) return null;

    items[idx].status = 'revoked';
    items[idx].updatedAt = nowIso();
    // Clear keys to prevent reuse
    items[idx].keys = null;
    await saveAgents(items);

    await auditWriter.write({
      actor: 'admin',
      action: 'agent.revoke',
      details: { agentId: id },
    });

    return true;
  },

  /**
   * Rotate agent keys. Returns new key pair (public and secret) but does not persist secret in logs.
   */
  async rotateAgentKeys(id: string) {
    const items = await loadAgents();
    const idx = items.findIndex((a) => a.id === id && a.status === 'active');
    if (idx === -1) return null;

    const keys = generateKeys();
    items[idx].keys = {
      publicKey: keys.publicKey,
      secretKey: keys.secretKey,
      createdAt: keys.createdAt,
    };
    items[idx].updatedAt = nowIso();
    await saveAgents(items);

    await auditWriter.write({
      actor: 'admin',
      action: 'agent.rotateKeys',
      details: { agentId: id, keyCreatedAt: keys.createdAt },
    });

    // Return keys to caller for provisioning. Caller must ensure secret is handled safely.
    return { publicKey: keys.publicKey, secretKey: keys.secretKey, createdAt: keys.createdAt };
  },

  /**
   * Redeploy agent configuration. This simulates notifying the agent or control plane.
   * Returns a result object describing the action outcome.
   */
  async redeployAgent(id: string) {
    const items = await loadAgents();
    const idx = items.findIndex((a) => a.id === id && a.status === 'active');
    if (idx === -1) return null;

    const rec = items[idx];
    // Simulate redeploy latency and response
    const result = {
      ok: true,
      agentId: id,
      message: `redeploy triggered for agent ${rec.name}`,
      timestamp: nowIso(),
    };

    await auditWriter.write({
      actor: 'admin',
      action: 'agent.redeploy',
      details: { agentId: id },
    });

    // In a real system we'd call a remote API or produce an event. Here we simply return success.
    return result;
  },
};

export default agentProxy;

