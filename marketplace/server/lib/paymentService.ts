import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import auditWriter from './auditWriter';

type PaymentStatus = 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled' | 'completed' | 'refunded';
type RefundStatus = 'pending' | 'succeeded' | 'failed';
type PayoutStatus = 'requested' | 'paid' | 'failed' | 'cancelled';

interface PaymentRecord {
  id: string;
  listingId?: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider?: string;
  providerChargeId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  history?: Array<{ ts: string; status: PaymentStatus; note?: string }>;
}

interface RefundRecord {
  id: string;
  paymentId: string;
  amount?: number;
  currency?: string;
  reason?: string;
  status: RefundStatus;
  createdAt: string;
  processedAt?: string | null;
}

interface PayoutRecord {
  id: string;
  paymentId: string;
  sellerId: string;
  method?: string;
  destination?: string;
  status: PayoutStatus;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

interface DownloadEntitlement {
  token: string;
  paymentId: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const REFUNDS_FILE = path.join(DATA_DIR, 'refunds.json');
const PAYOUTS_FILE = path.join(DATA_DIR, 'payouts.json');
const ENTITLEMENTS_FILE = path.join(DATA_DIR, 'entitlements.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('paymentService.ensureDataDir.failed', { err });
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
    logger.error('paymentService.writeJsonFile.failed', { err, file });
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function loadPayments(): Promise<PaymentRecord[]> {
  return await readJsonFile<PaymentRecord[]>(PAYMENTS_FILE, []);
}

async function savePayments(items: PaymentRecord[]) {
  await writeJsonFile(PAYMENTS_FILE, items);
}

async function loadRefunds(): Promise<RefundRecord[]> {
  return await readJsonFile<RefundRecord[]>(REFUNDS_FILE, []);
}

async function saveRefunds(items: RefundRecord[]) {
  await writeJsonFile(REFUNDS_FILE, items);
}

async function loadPayouts(): Promise<PayoutRecord[]> {
  return await readJsonFile<PayoutRecord[]>(PAYOUTS_FILE, []);
}

async function savePayouts(items: PayoutRecord[]) {
  await writeJsonFile(PAYOUTS_FILE, items);
}

async function loadEntitlements(): Promise<DownloadEntitlement[]> {
  return await readJsonFile<DownloadEntitlement[]>(ENTITLEMENTS_FILE, []);
}

async function saveEntitlements(items: DownloadEntitlement[]) {
  await writeJsonFile(ENTITLEMENTS_FILE, items);
}

const paymentService = {
  /**
   * Create a payment record for a listing purchase.
   * This function does not call external providers — it fabricates a pending payment.
   */
  async createPaymentForListing(opts: {
    listingId: string;
    buyerId: string;
    sellerId: string;
    amount: number;
    currency?: string;
    paymentMethodId?: string;
    coupon?: string;
    metadata?: Record<string, any>;
  }) {
    const payments = await loadPayments();
    const id = uuidv4();
    const now = nowIso();
    const record: PaymentRecord = {
      id,
      listingId: opts.listingId,
      buyerId: opts.buyerId,
      sellerId: opts.sellerId,
      amount: Math.round((opts.amount || 0) * 100) / 100,
      currency: opts.currency || 'USD',
      status: 'pending',
      metadata: { ...(opts.metadata || {}), coupon: opts.coupon || null, paymentMethodId: opts.paymentMethodId || null },
      createdAt: now,
      updatedAt: now,
      history: [{ ts: now, status: 'pending', note: 'created' }],
    };

    payments.push(record);
    await savePayments(payments);

    await auditWriter.write({
      actor: opts.buyerId,
      action: 'payment.created',
      details: { paymentId: id, listingId: opts.listingId, amount: record.amount, currency: record.currency },
    });

    return record;
  },

  async listPaymentsForUser(userId: string, opts: { q?: string; page?: number; limit?: number; status?: string } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(500, Number(opts.limit ?? 25)));
    const q = opts.q ? String(opts.q).toLowerCase() : undefined;
    const status = opts.status ? String(opts.status) : undefined;

    const payments = await loadPayments();
    let filtered = payments.filter((p) => p.buyerId === userId || p.sellerId === userId);

    if (status) filtered = filtered.filter((p) => p.status === status);
    if (q) {
      filtered = filtered.filter((p) => {
        if ((p.id || '').toLowerCase().includes(q)) return true;
        if ((p.metadata?.listingTitle || '').toLowerCase().includes(q)) return true;
        return false;
      });
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);
    return { total, items };
  },

  async getPaymentById(id: string) {
    const payments = await loadPayments();
    return payments.find((p) => p.id === id) || null;
  },

  /**
   * Confirm a payment (simulate provider confirm).
   * If paymentMethodId requires action, return a shape indicating requires_action.
   */
  async confirmPayment(id: string, opts: { paymentMethodId?: string; returnUrl?: string; actor?: string } = {}) {
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;

    const p = payments[idx];

    // Simulate provider requirements: if amount > 1000 -> require action
    if (p.amount > 1000 && !opts.paymentMethodId) {
      p.status = 'requires_action';
      p.updatedAt = nowIso();
      p.history = p.history || [];
      p.history.push({ ts: p.updatedAt, status: p.status, note: 'requires authentication' });
      await savePayments(payments);
      return p;
    }

    // Simulate successful charge
    p.status = 'succeeded';
    p.updatedAt = nowIso();
    p.provider = 'mock';
    p.providerChargeId = `ch_${uuidv4().slice(0, 8)}`;
    p.history = p.history || [];
    p.history.push({ ts: p.updatedAt, status: p.status, note: 'confirmed' });

    await savePayments(payments);

    await auditWriter.write({
      actor: opts.actor || p.buyerId,
      action: 'payment.confirmed',
      details: { paymentId: p.id, provider: p.provider, providerChargeId: p.providerChargeId },
    });

    return p;
  },

  async cancelPayment(id: string, opts: { reason?: string; actor?: string } = {}) {
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const p = payments[idx];
    if (p.status !== 'pending' && p.status !== 'requires_action') {
      return null;
    }
    p.status = 'cancelled';
    p.updatedAt = nowIso();
    p.history = p.history || [];
    p.history.push({ ts: p.updatedAt, status: p.status, note: opts.reason || 'cancelled by user' });
    await savePayments(payments);

    await auditWriter.write({
      actor: opts.actor || p.buyerId,
      action: 'payment.cancelled',
      details: { paymentId: id, reason: opts.reason || '' },
    });

    return p;
  },

  async refundPayment(id: string, opts: { amount?: number; currency?: string; reason?: string; initiatedBy?: string } = {}) {
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const p = payments[idx];

    // Only allow refund for succeeded/completed
    if (!(p.status === 'succeeded' || p.status === 'completed')) {
      return null;
    }

    const refunds = await loadRefunds();
    const refundId = uuidv4();
    const refund: RefundRecord = {
      id: refundId,
      paymentId: id,
      amount: typeof opts.amount === 'number' ? opts.amount : p.amount,
      currency: opts.currency || p.currency,
      reason: opts.reason || '',
      status: 'succeeded', // we simulate immediate success
      createdAt: nowIso(),
      processedAt: nowIso(),
    };
    refunds.push(refund);
    await saveRefunds(refunds);

    // mark payment as refunded if full
    const refundAmount = refund.amount || 0;
    if (Math.abs(refundAmount - (p.amount || 0)) < 0.001) {
      p.status = 'refunded';
      p.updatedAt = nowIso();
      p.history = p.history || [];
      p.history.push({ ts: p.updatedAt, status: p.status, note: `refunded ${refundAmount}` });
      await savePayments(payments);
    }

    await auditWriter.write({
      actor: opts.initiatedBy || 'admin',
      action: 'payment.refund',
      details: { paymentId: id, refundId, amount: refund.amount },
    });

    return refund;
  },

  async settlePayment(id: string, opts: { note?: string; actor?: string } = {}) {
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const p = payments[idx];

    p.status = 'completed';
    p.updatedAt = nowIso();
    p.history = p.history || [];
    p.history.push({ ts: p.updatedAt, status: p.status, note: opts.note || 'manually settled' });

    await savePayments(payments);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'payment.settle',
      details: { paymentId: id, note: opts.note || '' },
    });

    return p;
  },

  async retryPayment(id: string, opts: { reason?: string; actor?: string } = {}) {
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const p = payments[idx];
    if (p.status !== 'failed' && p.status !== 'requires_action') {
      return null;
    }

    // simulate retry leading to succeed
    p.status = 'succeeded';
    p.updatedAt = nowIso();
    p.provider = p.provider || 'mock';
    p.providerChargeId = p.providerChargeId || `ch_${uuidv4().slice(0, 8)}`;
    p.history = p.history || [];
    p.history.push({ ts: p.updatedAt, status: p.status, note: opts.reason || 'retried' });

    await savePayments(payments);

    await auditWriter.write({
      actor: opts.actor || 'system',
      action: 'payment.retry',
      details: { paymentId: id },
    });

    return p;
  },

  async holdPayment(id: string, opts: { reason?: string; actor?: string } = {}) {
    // For simplicity, we mark as pending with note
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const p = payments[idx];
    p.status = 'pending';
    p.updatedAt = nowIso();
    p.history = p.history || [];
    p.history.push({ ts: p.updatedAt, status: p.status, note: `held: ${opts.reason || ''}` });
    await savePayments(payments);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'payment.hold',
      details: { paymentId: id, reason: opts.reason || '' },
    });

    return p;
  },

  async releaseHold(id: string, opts: { reason?: string; actor?: string } = {}) {
    // Restore to previous successful state or pending
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const p = payments[idx];
    p.status = 'succeeded';
    p.updatedAt = nowIso();
    p.history = p.history || [];
    p.history.push({ ts: p.updatedAt, status: p.status, note: `released: ${opts.reason || ''}` });
    await savePayments(payments);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'payment.release',
      details: { paymentId: id, reason: opts.reason || '' },
    });

    return p;
  },

  async createPayout(paymentId: string, opts: { method?: string; destination?: string; note?: string; actor?: string } = {}) {
    const payments = await loadPayments();
    const p = payments.find((x) => x.id === paymentId);
    if (!p) return null;

    const payouts = await loadPayouts();
    const payout: PayoutRecord = {
      id: uuidv4(),
      paymentId,
      sellerId: p.sellerId,
      method: opts.method,
      destination: opts.destination,
      status: 'requested',
      note: opts.note,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    payouts.push(payout);
    await savePayouts(payouts);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'payment.payout.create',
      details: { payoutId: payout.id, paymentId },
    });

    return payout;
  },

  async requestPayout(paymentId: string, opts: { method?: string; destination?: string; note?: string; actor?: string } = {}) {
    // Alias to createPayout, but mark initiated by seller
    return await this.createPayout(paymentId, opts);
  },

  async getPaymentByProviderCharge(provider: string, chargeId: string) {
    const payments = await loadPayments();
    return payments.find((p) => p.provider === provider && p.providerChargeId === chargeId) || null;
  },

  async softDeletePayment(id: string, opts: { actor?: string } = {}) {
    // For simplicity, remove from payments.json
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    payments.splice(idx, 1);
    await savePayments(payments);

    await auditWriter.write({
      actor: opts.actor || 'system',
      action: 'payment.softDelete',
      details: { paymentId: id },
    });

    return true;
  },

  async createDownloadEntitlement(paymentId: string, opts: { actor?: string; ttlSeconds?: number } = {}) {
    const payments = await loadPayments();
    const p = payments.find((x) => x.id === paymentId);
    if (!p) return null;
    if (!(p.status === 'succeeded' || p.status === 'completed')) return null;

    const entitlements = await loadEntitlements();
    const token = uuidv4().replace(/-/g, '');
    const now = nowIso();
    const ttl = Number(opts.ttlSeconds ?? 300);
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const ent: DownloadEntitlement = {
      token,
      paymentId,
      userId: opts.actor || p.buyerId,
      expiresAt,
      createdAt: now,
    };
    entitlements.push(ent);
    await saveEntitlements(entitlements);

    await auditWriter.write({
      actor: opts.actor || p.buyerId,
      action: 'payment.download.entitlement.create',
      details: { paymentId, token, expiresAt },
    });

    return { token, expiresAt };
  },

  async verifyDownloadEntitlement(token: string) {
    const entitlements = await loadEntitlements();
    const ent = entitlements.find((e) => e.token === token);
    if (!ent) return null;
    if (new Date(ent.expiresAt).getTime() <= Date.now()) return null;
    return ent;
  },

  async listPayments(opts: { q?: string; page?: number; limit?: number; status?: string; userId?: string; method?: string } = {}) {
    // Admin listing
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(1000, Number(opts.limit ?? 25)));
    const q = opts.q ? String(opts.q).toLowerCase() : undefined;
    const status = opts.status ? String(opts.status) : undefined;
    const userId = opts.userId ? String(opts.userId) : undefined;

    const payments = await loadPayments();
    let filtered = payments.slice();
    if (status) filtered = filtered.filter((p) => p.status === status);
    if (userId) filtered = filtered.filter((p) => p.buyerId === userId || p.sellerId === userId);
    if (q) {
      filtered = filtered.filter((p) => (p.id || '').toLowerCase().includes(q) || (p.metadata?.listingTitle || '').toLowerCase().includes(q));
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);
    return { total, items };
  },

  async deletePayment(id: string, opts: { actor?: string } = {}) {
    // Hard delete
    const payments = await loadPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    payments.splice(idx, 1);
    await savePayments(payments);

    await auditWriter.write({
      actor: opts.actor || 'admin',
      action: 'payment.delete',
      details: { paymentId: id },
    });

    return true;
  },

  async getStats() {
    const payments = await loadPayments();
    const totalPayments = payments.length;
    let totalRevenue = 0;
    for (const p of payments) {
      if (p.status === 'succeeded' || p.status === 'completed') {
        totalRevenue += p.amount || 0;
      }
    }
    return { totalPayments, totalRevenue };
  },

  async handleProviderEvent(provider: string, normalized: any) {
    // Simple dispatcher for provider events (e.g., stripe)
    try {
      const kind = normalized.kind;
      const payload = normalized.payload || {};
      if (kind === 'payment.succeeded' || kind === 'payment.failed' || kind === 'payment.refund') {
        const chargeId = payload.chargeId || payload.providerChargeId || payload.id;
        if (!chargeId) return;
        const payment = await this.getPaymentByProviderCharge(provider, chargeId);
        if (!payment) return;
        if (kind === 'payment.succeeded') {
          payment.status = 'succeeded';
        } else if (kind === 'payment.failed') {
          payment.status = 'failed';
        } else if (kind === 'payment.refund') {
          payment.status = 'refunded';
        }
        payment.updatedAt = nowIso();
        payment.history = payment.history || [];
        payment.history.push({ ts: payment.updatedAt, status: payment.status, note: `provider:${kind}` });

        const payments = await loadPayments();
        const idx = payments.findIndex((p) => p.id === payment.id);
        if (idx !== -1) {
          payments[idx] = payment;
          await savePayments(payments);
        }

        await auditWriter.write({
          actor: `integration:${provider}`,
          action: 'payment.provider.event',
          details: { paymentId: payment.id, kind },
        });
      }
    } catch (err) {
      logger.error('paymentService.handleProviderEvent.failed', { err, provider, normalized });
    }
  },

  async userHasPurchasedListing(userId: string, listingId: string) {
    const payments = await loadPayments();
    return payments.some((p) => {
      const lid = p.metadata?.listingId || p.listingId;
      return lid === listingId && (p.buyerId === userId) && (p.status === 'succeeded' || p.status === 'completed');
    });
  },
};

export default paymentService;

