import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const router = Router();

/**
 * Helper types (local)
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

/**
 * Helpers to use DB if available
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
 * Helper to load order from DB or in-memory
 */
async function loadOrder(orderId: string): Promise<OrderRecord | null> {
  const db = getDb();
  if (db && typeof db.query === 'function') {
    const q = `SELECT order_id, sku_id, buyer_id, amount, currency, status, created_at, delivery, license, ledger_proof_id, payment
    FROM orders WHERE order_id = $1 LIMIT 1`;
    const r = await db.query(q, [orderId]);
    if (r && r.rows && r.rows[0]) {
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
      } as OrderRecord;
    }
    return null;
  }

  // In-memory fallback (shared with checkout route's in-memory store if present)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const checkoutRouter = require('./checkout.route');
    const inMemoryOrders = checkoutRouter && checkoutRouter.__inMemoryOrders;
    if (inMemoryOrders && typeof inMemoryOrders.get === 'function') {
      return inMemoryOrders.get(orderId) || null;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Helper to persist an order
 */
async function persistOrder(order: OrderRecord) {
  const db = getDb();
  if (db && typeof db.query === 'function') {
    const q = `INSERT INTO orders (order_id, sku_id, buyer_id, amount, currency, status, created_at, payment, delivery, license, ledger_proof_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (order_id) DO UPDATE SET status=EXCLUDED.status, payment=EXCLUDED.payment, delivery=EXCLUDED.delivery, license=EXCLUDED.license, ledger_proof_id=EXCLUDED.ledger_proof_id`;
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

  // In-memory fallback (write back into checkout route's store if possible)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const checkoutRouter = require('./checkout.route');
    const inMemoryOrders = checkoutRouter && checkoutRouter.__inMemoryOrders;
    if (inMemoryOrders && typeof inMemoryOrders.set === 'function') {
      inMemoryOrders.set(order.order_id, order);
      return;
    }
  } catch {
    // ignore
  }

  // As a final fallback, store on a module-local map
  ;(persistOrder as any).__localStore = (persistOrder as any).__localStore || new Map();
  (persistOrder as any).__localStore.set(order.order_id, order);
}

/**
 * Emit audit event if auditWriter exists
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
 * Validate ledger proof with financeClient if available (best-effort).
 */
async function verifyLedgerProofWithFinance(ledgerProof: any): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const financeMod = require('../lib/financeClient');
    const financeClient = financeMod && (financeMod.default || financeMod);
    if (financeClient && typeof financeClient.verifyLedgerProof === 'function') {
      return await financeClient.verifyLedgerProof(ledgerProof);
    }
  } catch {
    // ignore
  }
  // Fallback: accept any ledger proof in dev
  return true;
}

/**
 * Produce license/delivery/proof either via artifactPublisherClient or synthesize.
 */
async function produceArtifacts(order: OrderRecord, ledgerProof: any) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const apMod = require('../lib/artifactPublisherClient');
    const apClient = apMod && (apMod.default || apMod);
    if (apClient && typeof apClient.publishDelivery === 'function') {
      return await apClient.publishDelivery({
        orderId: order.order_id,
        skuId: order.sku_id,
        buyerId: order.buyer_id,
        ledgerProof,
      });
    }
  } catch {
    // ignore and synthesize
  }

  // Synthesize license + delivery + proof
  const licenseId = `lic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const license = {
    license_id: licenseId,
    order_id: order.order_id,
    sku_id: order.sku_id,
    buyer_id: order.buyer_id,
    scope: { type: 'single-user', expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() },
    issued_at: new Date().toISOString(),
    signer_kid: process.env.MARKETPLACE_SIGNER_KID || 'marketplace-signer-v1',
    signature: Buffer.from(`license:${licenseId}`).toString('base64'),
  };

  const artifactSha256 = crypto.createHash('sha256').update(order.order_id + order.sku_id).digest('hex');
  const proofId = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const proof = {
    proof_id: proofId,
    order_id: order.order_id,
    artifact_sha256: artifactSha256,
    manifest_signature_id: `manifest-sig-${Math.random().toString(36).slice(2, 6)}`,
    ledger_proof_id: ledgerProof?.ledger_proof_id || ledgerProof?.ledgerProofId || `ledger-sim-${Date.now()}`,
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
 * GET /order/:order_id
 */
router.get('/order/:order_id', async (req: Request, res: Response) => {
  const orderId = String(req.params.order_id || '').trim();
  if (!orderId) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_ORDER_ID', message: 'order_id is required' } });
  }

  try {
    const order = (await loadOrder(orderId)) || (persistOrder as any).__localStore?.get(orderId) || null;
    if (!order) {
      return res.status(404).json({ ok: false, error: { code: 'ORDER_NOT_FOUND', message: `Order ${orderId} not found` } });
    }
    return res.json({ ok: true, order });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'ORDER_FETCH_ERROR', message: err?.message || 'Failed to fetch order' } });
  }
});

/**
 * POST /order/:order_id/finalize
 * Body:
 * { ledger_proof_id, ledger_proof_signature, ledger_proof_signer_kid, ledger_proof_payload? }
 *
 * This endpoint is expected to be called by Marketplace server when Finance returns a ledger proof,
 * or by a control-plane operator. It validates the ledger proof (best-effort) and produces license/delivery/proof.
 */
router.post('/order/:order_id/finalize', async (req: Request, res: Response) => {
  const orderId = String(req.params.order_id || '').trim();
  if (!orderId) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_ORDER_ID', message: 'order_id is required' } });
  }

  const body = req.body || {};
  const ledgerProof = {
    ledger_proof_id: body.ledger_proof_id || body.ledgerProofId || body.ledger_proof_id,
    signature: body.ledger_proof_signature || body.signature,
    signer_kid: body.ledger_proof_signer_kid || body.signer_kid,
    payload: body.ledger_proof_payload || body.payload,
  };

  if (!ledgerProof.ledger_proof_id) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_LEDGER_PROOF', message: 'ledger_proof_id required' } });
  }

  try {
    const order = (await loadOrder(orderId)) || (persistOrder as any).__localStore?.get(orderId) || null;
    if (!order) {
      return res.status(404).json({ ok: false, error: { code: 'ORDER_NOT_FOUND', message: `Order ${orderId} not found` } });
    }

    // Verify ledger proof if finance client available
    const verified = await verifyLedgerProofWithFinance(ledgerProof);
    if (!verified) {
      return res.status(400).json({ ok: false, error: { code: 'LEDGER_PROOF_INVALID', message: 'Ledger proof failed verification' } });
    }

    // Attach ledger proof id and mark as settled
    order.ledger_proof_id = ledgerProof.ledger_proof_id;
    order.status = 'settled';
    await persistOrder(order);
    await appendAuditEvent('ledger.proof.registered', req.context?.actorId, { order_id: orderId, ledger_proof_id: order.ledger_proof_id });

    // Produce license/delivery/proof
    const artifacts = await produceArtifacts(order, ledgerProof);
    order.license = artifacts.license;
    order.delivery = artifacts.delivery;
    // we may want to persist proof separately; place proof under delivery or return it via /proofs endpoint
    order.status = 'finalized';
    await persistOrder(order);

    await appendAuditEvent('order.finalized', req.context?.actorId, {
      order_id: orderId,
      license_id: artifacts.license?.license_id,
      delivery_id: artifacts.delivery?.delivery_id,
      proof_id: artifacts.proof?.proof_id || artifacts.delivery?.proof_id,
    });

    return res.json({
      ok: true,
      order: {
        order_id: order.order_id,
        status: order.status,
        license: order.license,
        delivery: order.delivery,
        ledger_proof_id: order.ledger_proof_id,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'FINALIZE_ERROR', message: err?.message || 'Failed to finalize order' } });
  }
});

/**
 * GET /order/:order_id/license
 * Return the signed license for an order (for buyer or auditor with rights).
 */
router.get('/order/:order_id/license', async (req: Request, res: Response) => {
  const orderId = String(req.params.order_id || '').trim();
  if (!orderId) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_ORDER_ID', message: 'order_id is required' } });
  }

  try {
    const order = (await loadOrder(orderId)) || (persistOrder as any).__localStore?.get(orderId) || null;
    if (!order) return res.status(404).json({ ok: false, error: { code: 'ORDER_NOT_FOUND', message: `Order ${orderId} not found` } });
    if (!order.license) return res.status(404).json({ ok: false, error: { code: 'LICENSE_NOT_FOUND', message: 'License not issued for this order' } });
    return res.json({ ok: true, license: { license_id: order.license.license_id, signed_license: order.license } });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'LICENSE_FETCH_ERROR', message: err?.message || 'Failed to fetch license' } });
  }
});

/**
 * GET /order/:order_id/audit
 * Best-effort: attempt to read audit events referencing this order from auditWriter or DB exports.
 */
router.get('/order/:order_id/audit', async (req: Request, res: Response) => {
  const orderId = String(req.params.order_id || '').trim();
  if (!orderId) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_ORDER_ID', message: 'order_id is required' } });
  }

  try {
    // Try auditWriter if it exposes a read method (not required)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const auditMod = require('../lib/auditWriter');
      const auditWriter = auditMod && (auditMod.default || auditMod);
      if (auditWriter && typeof auditWriter.queryEvents === 'function') {
        const audit = await auditWriter.queryEvents({ orderId });
        return res.json({ ok: true, audit });
      }
    } catch {
      // ignore
    }

    // Try DB table audit_events
    const db = getDb();
    if (db && typeof db.query === 'function') {
      // This assumes audit_events stores a json payload object
      const q = `SELECT actor_id, event_type, payload, created_at, hash, signature, signer_kid FROM audit_events WHERE (payload->>'order_id' = $1 OR payload->>'orderId' = $1) ORDER BY created_at DESC LIMIT 100`;
      const r = await db.query(q, [orderId]);
      const list = (r.rows || []).map((row: any) => ({
        actor_id: row.actor_id,
        event_type: row.event_type,
        payload: row.payload,
        created_at: row.created_at,
        hash: row.hash,
        signature: row.signature,
        signer_kid: row.signer_kid,
      }));
      return res.json({ ok: true, audit: list });
    }

    // Last resort: return empty array (not an error)
    return res.json({ ok: true, audit: [] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'AUDIT_FETCH_ERROR', message: err?.message || 'Failed to fetch audit events' } });
  }
});

export default router;

