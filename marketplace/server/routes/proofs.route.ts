import { Router, Request, Response } from 'express';

const router = Router();

type ProofRecord = {
  proof_id: string;
  order_id?: string;
  artifact_sha256?: string;
  manifest_signature_id?: string;
  ledger_proof_id?: string;
  signer_kid?: string;
  signature?: string;
  ts?: string;
  canonical_payload?: any;
  key_metadata?: any;
  delivery_mode?: string;
  encryption?: any;
};

type LightweightOrder = {
  order_id?: string;
  delivery?: {
    proof_id?: string;
    artifact_sha256?: string;
    manifest_signature_id?: string;
    ledger_proof_id?: string;
    signer_kid?: string;
    signature?: string;
    ts?: string;
    canonical_payload?: any;
    key_metadata?: any;
    mode?: string;
    encryption?: any;
    proof?: {
      proof_id?: string;
      signature?: string;
      signer_kid?: string;
      artifact_sha256?: string;
      manifest_signature_id?: string;
      ledger_proof_id?: string;
      ts?: string;
      canonical_payload?: any;
    };
  };
  ledger_proof_id?: string;
  key_metadata?: Record<string, any>;
  delivery_mode?: string;
};

/**
 * Helper: try to get DB client
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
 * Try to fetch proof from DB (proofs table)
 */
async function fetchProofFromDb(proofId: string): Promise<ProofRecord | null> {
  const db = getDb();
  if (!db || typeof db.query !== 'function') return null;
  try {
    const q = `SELECT proof_id, order_id, artifact_sha256, manifest_signature_id, ledger_proof_id, signer_kid, signature, ts, canonical_payload
      FROM proofs WHERE proof_id = $1 LIMIT 1`;
    const r = await db.query(q, [proofId]);
    if (r && r.rows && r.rows.length > 0) {
      const row = r.rows[0];
      return {
        proof_id: row.proof_id,
        order_id: row.order_id,
        artifact_sha256: row.artifact_sha256,
        manifest_signature_id: row.manifest_signature_id,
        ledger_proof_id: row.ledger_proof_id,
        signer_kid: row.signer_kid,
        signature: row.signature,
        ts: row.ts,
        canonical_payload: row.canonical_payload,
      };
    }
  } catch (e) {
    // ignore DB errors for fallback behavior
    // eslint-disable-next-line no-console
    console.debug('fetchProofFromDb error:', (e as Error).message);
  }
  return null;
}

/**
 * Try to fetch proof from ArtifactPublisher client if available
 */
async function fetchProofFromArtifactPublisher(proofId: string): Promise<ProofRecord | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const apMod = require('../lib/artifactPublisherClient');
    const apClient = apMod && (apMod.default || apMod);
    if (apClient && typeof apClient.getProof === 'function') {
      const p = await apClient.getProof(proofId);
      if (p) {
        // Normalize shape
        return {
          proof_id: p.proof_id || proofId,
          order_id: p.order_id,
          artifact_sha256: p.artifact_sha256,
          manifest_signature_id: p.manifest_signature_id || p.manifestSignatureId,
          ledger_proof_id: p.ledger_proof_id || p.ledgerProofId,
          signer_kid: p.signer_kid || p.signerKid,
          signature: p.signature,
          ts: p.ts,
          canonical_payload: p.canonical_payload || p.canonicalPayload,
        };
      }
    }
  } catch (e) {
    // ignore
    // eslint-disable-next-line no-console
    console.debug('artifactPublisherClient.getProof not available or errored:', (e as Error).message);
  }
  return null;
}

/**
 * Try to find proof attached to orders (order.delivery.proof_id or order.delivery.proof)
 */
async function fetchProofFromOrders(proofId: string): Promise<ProofRecord | null> {
  // 1) Try DB orders table join to proofs/delivery if available
  try {
    const db = getDb();
    if (db && typeof db.query === 'function') {
      // Attempt to join orders -> proofs if proofs table exists; otherwise try to select delivery/proof JSON from orders table.
      // First, try proof table join
      try {
        const qJoin = `SELECT p.proof_id, p.order_id, p.artifact_sha256, p.manifest_signature_id, p.ledger_proof_id, p.signer_kid, p.signature, p.ts, p.canonical_payload
          FROM proofs p WHERE p.proof_id = $1 LIMIT 1`;
        const rJoin = await db.query(qJoin, [proofId]);
        if (rJoin && rJoin.rows && rJoin.rows.length > 0) {
          const row = rJoin.rows[0];
          return {
            proof_id: row.proof_id,
            order_id: row.order_id,
            artifact_sha256: row.artifact_sha256,
            manifest_signature_id: row.manifest_signature_id,
            ledger_proof_id: row.ledger_proof_id,
            signer_kid: row.signer_kid,
            signature: row.signature,
            ts: row.ts,
            canonical_payload: row.canonical_payload,
          };
        }
      } catch {
        // ignore join errors
      }

      // Fallback: check orders table for delivery/proof JSON
      try {
        const q = `SELECT order_id, delivery, license, key_metadata, delivery_mode FROM orders WHERE delivery->>'proof_id' = $1 LIMIT 1`;
        const r = await db.query(q, [proofId]);
        if (r && r.rows && r.rows.length > 0) {
          const row = r.rows[0];
          const delivery = row.delivery || {};
          const proof = (delivery && delivery.proof) || (delivery && { proof_id: delivery.proof_id, signature: delivery.signature, signer_kid: delivery.signer_kid });
          return {
            proof_id: proofId,
            order_id: row.order_id,
            artifact_sha256: proof?.artifact_sha256 || delivery?.artifact_sha256,
            manifest_signature_id: proof?.manifest_signature_id || delivery?.manifest_signature_id,
            ledger_proof_id: proof?.ledger_proof_id || delivery?.ledger_proof_id,
            signer_kid: proof?.signer_kid || delivery?.signer_kid,
            signature: proof?.signature || delivery?.signature,
            ts: proof?.ts || delivery?.ts,
            canonical_payload: proof?.canonical_payload || delivery?.canonical_payload,
            key_metadata: row.key_metadata || delivery?.key_metadata,
            delivery_mode: row.delivery_mode || delivery?.mode,
            encryption: delivery?.encryption,
          };
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  // 2) Try in-memory orders from checkout.route or order.route
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const checkoutRouter = require('./checkout.route');
    const inMemoryOrders = (checkoutRouter && checkoutRouter.__inMemoryOrders) as Map<string, LightweightOrder> | undefined;
    if (inMemoryOrders && typeof inMemoryOrders.values === 'function') {
      for (const order of Array.from(inMemoryOrders.values())) {
        if (order?.delivery?.proof_id === proofId || order?.delivery?.proof?.proof_id === proofId) {
          const proof = order.delivery.proof || { proof_id: order.delivery.proof_id, signature: order.delivery.signature, signer_kid: order.delivery.signer_kid };
          return {
            proof_id: proofId,
            order_id: order.order_id,
            artifact_sha256: proof?.artifact_sha256,
            manifest_signature_id: proof?.manifest_signature_id,
            ledger_proof_id: order.ledger_proof_id,
            signer_kid: proof?.signer_kid,
            signature: proof?.signature,
            ts: proof?.ts,
            canonical_payload: proof?.canonical_payload,
            key_metadata: order.key_metadata || order.delivery?.key_metadata,
            delivery_mode: order.delivery_mode || order.delivery?.mode,
            encryption: order.delivery?.encryption,
          };
        }
      }
    }
  } catch {
    // ignore
  }

  // 3) Try the persistOrder.__localStore used by order.route as a last resort
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const orderRoute = require('./order.route');
    const localStore = (orderRoute && orderRoute.__localStore) as Map<string, LightweightOrder> | undefined;
    if (localStore && typeof localStore.values === 'function') {
      for (const order of Array.from(localStore.values())) {
        if (order?.delivery?.proof_id === proofId || order?.delivery?.proof?.proof_id === proofId) {
          const proof = order.delivery.proof || { proof_id: order.delivery.proof_id, signature: order.delivery.signature, signer_kid: order.delivery.signer_kid };
          return {
            proof_id: proofId,
            order_id: order.order_id,
            artifact_sha256: proof?.artifact_sha256,
            signer_kid: proof?.signer_kid,
            signature: proof?.signature,
            ts: proof?.ts,
            canonical_payload: proof?.canonical_payload,
            key_metadata: order.key_metadata || order.delivery?.key_metadata,
            delivery_mode: order.delivery_mode || order.delivery?.mode,
            encryption: order.delivery?.encryption,
          };
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * GET /proofs/:proof_id
 */
router.get('/proofs/:proof_id', async (req: Request, res: Response) => {
  const proofId = String(req.params.proof_id || '').trim();
  if (!proofId) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_PROOF_ID', message: 'proof_id is required' } });
  }

  try {
    // Try DB
    const dbProof = await fetchProofFromDb(proofId);
    if (dbProof) {
      return res.json({ ok: true, proof: dbProof });
    }

    // Try artifact publisher
    const apProof = await fetchProofFromArtifactPublisher(proofId);
    if (apProof) {
      return res.json({ ok: true, proof: apProof });
    }

    // Try orders/deliveries
    const orderProof = await fetchProofFromOrders(proofId);
    if (orderProof) {
      return res.json({ ok: true, proof: orderProof });
    }

    // Dev fallback: synthesize a proof if in non-production
    if (process.env.NODE_ENV !== 'production') {
      const synthetic = {
        proof_id: proofId,
        order_id: `order-${Math.random().toString(36).slice(2, 8)}`,
        artifact_sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        manifest_signature_id: `manifest-sig-dev-${Math.random().toString(36).slice(2, 6)}`,
        ledger_proof_id: `ledger-sim-${Date.now()}`,
        signer_kid: 'artifact-publisher-signer-v1',
        signature: Buffer.from(`simulated:${proofId}`).toString('base64'),
        ts: new Date().toISOString(),
      };
      return res.json({ ok: true, proof: synthetic });
    }

    return res.status(404).json({ ok: false, error: { code: 'PROOF_NOT_FOUND', message: `Proof ${proofId} not found` } });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'PROOF_FETCH_ERROR', message: err?.message || 'Failed to fetch proof' } });
  }
});

export default router;
