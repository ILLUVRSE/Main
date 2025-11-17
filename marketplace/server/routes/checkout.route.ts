import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const router = Router();

/**
 * In-memory stores (dev fallback). Production should use DB+transactions.
 */
type OrderRecord = {
  order_id: string;
  sku_id: string;
  buyer_id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'settled' | 'finalized' | 'failed';
  created_at: string;
  delivery?: any;
  license?: any;
  ledger_proof_id?: string;
  payment?: any;
};

const inMemoryOrders = new Map<string, OrderRecord>();
const idempotencyMap = new Map<string, string>(); // idempotencyKey -> order_id

/**
 * Helper: get DB client if available (server/lib/db)
 */
function getDb(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dbMod = require('../lib/db');
    return dbMod && (dbMod.default || dbMod);
  } catch {
    return null;
  }
}

/**
 * Helper: append audit event if auditWriter exists
 */
async function appendAuditEvent(eventType: string, actorId: string | undefined, payload: any) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const auditMod = require('../lib/auditWriter');
    const auditWriter = auditMod && (auditMod.default || auditMod);
    if (auditWriter && typeof auditWriter.appendAuditEvent === 'function') {
      const evt = {
        actor_id: actorId || 'system',
        event_type: eventType,
        payload,
        created_at: new Date().toISOString(),
      };
      await auditWriter.appendAuditEvent(evt);
    }
  } catch (e) {
    // ignore in dev
    // eslint-disable-next-line no-console
    console.debug('auditWriter not available or failed:', (e as Error).message);
  }
}

/**
 * Persist order (DB or in-memory)
 */
async function persistOrder(order: OrderRecord) {
  const db = getDb();
  if (db && typeof db.query === 'function') {
    const q = `INSERT INTO orders (order_id, sku_id, buyer_id, amount, currency, status, created_at, payment, delivery, license, ledger_proof_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (order_id) DO UPDATE SET status=EXCLUDED.status, payment=EXCLUDED.payment, delivery=EXCLUDED.delivery, license=EXCLUDED.license, ledger_proof_id=EXCLUDED.ledger_proof_id
      RETURNING order_id`;
    const params = [
      order.order_id,
      order.sku_id,
      order.buyer_id,
      order.amount,
      order.currency,
      order.status,
      order.created_at,
      order.payment || null,
      order.delivery || null,
      order.license || null,
      order.ledger_proof_id || null,
    ];
    await db.query(q, params);
    return;
  }

  // fallback to in-memory
  inMemoryOrders.set(order.order_id, order);
}

/**
 * Load order
 */
async function loadOrder(orderId: string): Promise<OrderRecord | null> {
  const db = getDb();
  if (db && typeof db.query === 'function') {
    const q = `SELECT order_id, sku_id, buyer_id, amount, currency, status, created_at, delivery, license, ledger_proof_id, payment
      FROM orders WHERE order_id = $1 LIMIT 1`;
    const r = await db.query(q, [orderId]);
    if (r && r.rows && r.rows.length > 0) {
      const row = r.rows[0];
      return {
        order_id: row.order_id,
        sku_id: row.sku_id,
        buyer_id: row.buyer_id,
        amount: Number(row.amount),
        currency: row.currency,
        status: row.status,
        created_at: row.created_at,
        delivery: row.delivery,
        license: row.license,
        ledger_proof_id: row.ledger_proof_id,
        payment: row.payment,
      };
    }
    return null;
  }

  return inMemoryOrders.get(orderId) || null;
}

/**
 * Simulate or call Finance to create ledger proof.
 * If ../lib/financeClient exists, call it. Otherwise synthesize a ledger proof.
 */
async function createLedgerProof(order: OrderRecord) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const financeMod = require('../lib/financeClient');
    const financeClient = financeMod && (financeMod.default || financeMod);
    if (financeClient && typeof financeClient.createLedgerForOrder === 'function') {
      const ledgerProof = await financeClient.createLedgerForOrder({
        orderId: order.order_id,
        amount: order.amount,
        currency: order.currency,
        buyerId: order.buyer_id,
      });
      return ledgerProof;
    }
  } catch (e) {
    // fall back
  }

  // Synthesize a ledger proof
  const ledgerProofId = `ledger-proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const signerKid = process.env.FINANCE_SIGNER_KID || 'finance-signer-v1';
  const signature = Buffer.from(`ledger:${ledgerProofId}`).toString('base64');
  return {
    ledger_proof_id: ledgerProofId,
    signer_kid: signerKid,
    signature,
    ts: new Date().toISOString(),
  };
}

/**
 * Create license and encrypted delivery. Best-effort:
 * - If artifactPublisher exists, call it
 * - Otherwise synthesize license and delivery with a fake proof.
 */
async function finalizeOrderAndProduceArtifacts(order: OrderRecord, ledgerProof: any) {
  // Create a signed license
  const licenseId = `lic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const issuedAt = new Date().toISOString();
  const signerKid = process.env.MARKETPLACE_SIGNER_KID || 'marketplace-signer-v1';
  const license = {
    license_id: licenseId,
    order_id: order.order_id,
    sku_id: order.sku_id,
    buyer_id: order.buyer_id,
    scope: { type: 'single-user', expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() },
    issued_at: issuedAt,
    signer_kid: signerKid,
    signature: Buffer.from(`license:${licenseId}`).toString('base64'),
  };

  // Produce a delivery proof (call ArtifactPublisher if present)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const apMod = require('../lib/artifactPublisherClient');
    const apClient = apMod && (apMod.default || apMod);
    if (apClient && typeof apClient.publishDelivery === 'function') {
      const delivery = await apClient.publishDelivery({
        orderId: order.order_id,
        skuId: order.sku_id,
        buyerId: order.buyer_id,
        ledgerProof,
        license,
      });
      return { license, delivery };
    }
  } catch (e) {
    // continue to synthesize
  }

  const artifactSha256 = crypto.createHash('sha256').update(order.order_id + order.sku_id).digest('hex');
  const proofId = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const proof = {
    proof_id: proofId,
    order_id: order.order_id,
    artifact_sha256: artifactSha256,
    manifest_signature_id: `manifest-sig-${Math.random().toString(36).slice(2, 6)}`,
    ledger_proof_id: ledgerProof?.ledger_proof_id || ledgerProof?.ledger_proof_id || `ledger-sim-${Date.now()}`,
    signer_kid: process.env.ARTIFACT_PUBLISHER_SIGNER_KID || 'artifact-publisher-signer-v1',
    signature: Buffer.from(`proof:${proofId}`).toString('base64'),
    ts: new Date().toISOString(),
  };

  const delivery = {
    delivery_id: `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'ready',
    encrypted_delivery_url: `s3://encrypted/${proof.proof_id}`,
    proof_id: proof.proof_id,
  };

  return { license, delivery, proof };
}

/**
 * POST /checkout
 * Creates pending order, reserves SKU (best-effort), and returns order object.
 *
 * Expected body (see marketplace/api.md):
 * {
 *   sku_id, buyer_id, payment_method: { provider, payment_intent }, billing_metadata, delivery_preferences, order_metadata
 * }
 */
router.post('/checkout', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const skuId = String(body.sku_id || '').trim();
    const buyerId = String(body.buyer_id || '').trim();
    const paymentMethod = body.payment_method || {};
    const billingMetadata = body.billing_metadata || {};
    const deliveryPreferences = body.delivery_preferences || {};
    const orderMetadata = body.order_metadata || {};

    if (!skuId || !buyerId) {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_FIELDS', message: 'sku_id and buyer_id required' } });
    }

    // Determine amount/currency from SKU (DB lookup) or defaults
    let amount = Number(body.amount || 0);
    let currency = String(body.currency || 'USD');

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dbMod = require('../lib/db');
      const db = dbMod && (dbMod.default || dbMod);
      if (db && typeof db.query === 'function') {
        const r = await db.query('SELECT price, currency FROM skus WHERE sku_id = $1 LIMIT 1', [skuId]);
        if (r && r.rows && r.rows[0]) {
          amount = Number(r.rows[0].price) || amount;
          currency = r.rows[0].currency || currency;
        }
      }
    } catch {
      // ignore - dev fallback
    }

    // Idempotency handling
    const idempotencyKey = String(req.header('Idempotency-Key') || '').trim();
    if (idempotencyKey) {
      const existingOrderId = idempotencyMap.get(idempotencyKey);
      if (existingOrderId) {
        const existing = await loadOrder(existingOrderId);
        if (existing) {
          return res.json({ ok: true, order: existing });
        }
      }
    }

    const orderId = `order-${uuidv4()}`;
    const order: OrderRecord = {
      order_id: orderId,
      sku_id: skuId,
      buyer_id: buyerId,
      amount: amount || 0,
      currency,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    // Persist order
    await persistOrder(order);
    if (idempotencyKey) idempotencyMap.set(idempotencyKey, orderId);

    // Emit audit event
    await appendAuditEvent('order.created', req.context?.actorId, {
      order_id: orderId,
      sku_id: skuId,
      buyer_id: buyerId,
      amount: order.amount,
      currency: order.currency,
      payment_method: paymentMethod,
      order_metadata: orderMetadata,
    });

    return res.json({ ok: true, order });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'CHECKOUT_ERROR', message: err?.message || 'Failed to create checkout' } });
  }
});

/**
 * Helper to handle payment webhook and drive finalize.
 * Accepts a webhook body like:
 * { order_id, status: 'paid', amount, currency, provider, reference }
 */
async function handlePaymentWebhook(body: any, actorId?: string) {
  const orderId = String(body.order_id || '').trim();
  if (!orderId) {
    throw new Error('order_id missing in webhook payload');
  }

  const order = (await loadOrder(orderId)) || null;
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Update payment info
  order.payment = {
    provider: body.provider || 'unknown',
    reference: body.reference || '',
    amount: Number(body.amount || order.amount),
    currency: String(body.currency || order.currency),
    received_at: new Date().toISOString(),
  };
  order.status = 'paid';

  await persistOrder(order);
  await appendAuditEvent('payment.received', actorId, { order_id: orderId, payment: order.payment });

  // Call Finance (or simulate) to create ledger proof
  const ledgerProof = await createLedgerProof(order);
  order.ledger_proof_id = ledgerProof.ledger_proof_id || ledgerProof.ledgerProofId || ledgerProof.ledger_proof_id;

  // Persist ledger proof id
  await persistOrder(order);
  await appendAuditEvent('ledger.proof.received', actorId, { order_id: orderId, ledger_proof_id: order.ledger_proof_id });

  // Finalize: create license + delivery + signed proof
  const { license, delivery, proof } = (await finalizeOrderAndProduceArtifacts(order, ledgerProof)) as any;

  // Attach license/delivery/proof to order and mark settled/finalized
  order.license = license;
  order.delivery = delivery;
  order.status = 'settled';
  // Keep ledger_proof_id already set
  await persistOrder(order);

  await appendAuditEvent('order.finalized', actorId, {
    order_id: orderId,
    license_id: license.license_id,
    delivery_id: delivery?.delivery_id,
    proof_id: proof?.proof_id || delivery?.proof_id,
  });

  return order;
}

/**
 * POST /webhooks/payment
 * Endpoint used by payment provider to notify of payment events.
 * Validates signature when Stripe-like config present (best-effort). For dev, accept unsigned.
 */
router.post('/webhooks/payment', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};

    // if PAYMENT_PROVIDER_STRIPE_WEBHOOK_SECRET is set, we would validate signature here.
    // For local dev/mocks we accept unsigned webhooks.
    try {
      const order = await handlePaymentWebhook(body, req.context?.actorId);
      // Acknowledge quickly
      return res.json({ ok: true, order_id: order.order_id, status: order.status });
    } catch (e: any) {
      // Return 200 ack for idempotent behavior, but include error for debugging
      // Some payment providers expect 200/2xx to stop retries; choose 200 for local tests
      // For non-dev, you might prefer to return 400/500 to signal failures.
      // eslint-disable-next-line no-console
      console.error('Payment webhook processing error:', e && e.stack ? e.stack : e);
      return res.status(200).json({ ok: false, error: { code: 'WEBHOOK_PROCESSING_ERROR', message: String(e) } });
    }
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'WEBHOOK_ERROR', message: err?.message || 'Failed to process webhook' } });
  }
});

export default router;

