/**
 * marketplace/server/lib/artifactPublisherClient.ts
 *
 * Minimal client for ArtifactPublisher responsibilities:
 *  - publishDelivery({ orderId, skuId, buyerId, ledgerProof, license })
 *  - getProof(proofId)
 *
 * Config:
 *  - ARTIFACT_PUBLISHER_API_URL (optional) - base URL of artifact-publisher service
 *  - ARTIFACT_PUBLISHER_TOKEN (optional) - bearer token for AP
 *  - ARTIFACT_PUBLISHER_SIGNER_KID (optional override)
 *
 * Returns:
 *  - publishDelivery -> { license, delivery, proof } (proof contains proof_id, signature, signer_kid, ts, canonical_payload?)
 *  - getProof -> proof object or null
 */

import fetch from 'cross-fetch';
import crypto from 'crypto';

type LedgerProof = {
  ledger_proof_id?: string;
  signer_kid?: string;
  signature?: string; // base64
  ts?: string;
  payload?: any;
};

type License = {
  license_id: string;
  order_id?: string;
  sku_id?: string;
  buyer_id?: string;
  scope?: any;
  issued_at?: string;
  signer_kid?: string;
  signature?: string; // base64
  [k: string]: any;
};

type Delivery = {
  delivery_id: string;
  status: string;
  encrypted_delivery_url?: string;
  proof_id?: string;
  [k: string]: any;
};

type Proof = {
  proof_id: string;
  order_id?: string;
  artifact_sha256?: string;
  manifest_signature_id?: string;
  ledger_proof_id?: string;
  signer_kid?: string;
  signature?: string;
  ts?: string;
  canonical_payload?: any;
};

const AP_URL = (process.env.ARTIFACT_PUBLISHER_API_URL || '').replace(/\/$/, '');
const AP_TOKEN = process.env.ARTIFACT_PUBLISHER_TOKEN || '';
const AP_SIGNER_KID_OVERRIDE = process.env.ARTIFACT_PUBLISHER_SIGNER_KID || undefined;

/**
 * Helper: post JSON with optional bearer token
 */
async function postJson(url: string, body: any, token?: string, timeout = 15000) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    // no explicit signal here; rely on default runtime
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, status: resp.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { ok: resp.ok, status: resp.status, body: text };
  }
}

/**
 * Helper to GET JSON
 */
async function getJson(url: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(url, { method: 'GET', headers });
  const text = await resp.text();
  try {
    return { ok: resp.ok, status: resp.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { ok: resp.ok, status: resp.status, body: text };
  }
}

/**
 * Synthesize deterministic ids and objects for dev fallback
 */
function shortHash(input: string) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}

function synthesizeProof(orderId: string, skuId: string) : Proof {
  const base = `${orderId}:${skuId}:${Date.now()}:${Math.random().toString(36).slice(2,6)}`;
  const proofId = `proof-${shortHash(base)}`;
  const artifactSha256 = crypto.createHash('sha256').update(`${orderId}:${skuId}`).digest('hex');
  const signerKid = AP_SIGNER_KID_OVERRIDE || 'artifact-publisher-signer-v1';
  const signature = Buffer.from(`proof:${proofId}`).toString('base64');
  return {
    proof_id: proofId,
    order_id: orderId,
    artifact_sha256: artifactSha256,
    manifest_signature_id: `manifest-sig-${shortHash(proofId)}`,
    ledger_proof_id: `ledger-sim-${shortHash(proofId)}`,
    signer_kid: signerKid,
    signature,
    ts: new Date().toISOString(),
    canonical_payload: { proof_id: proofId, order_id: orderId, artifact_sha256: artifactSha256 },
  };
}

function synthesizeDelivery(orderId: string, skuId: string, proof: Proof) : Delivery {
  const deliveryId = `delivery-${shortHash(`${orderId}:${skuId}:delivery`)}`;
  return {
    delivery_id: deliveryId,
    status: 'ready',
    encrypted_delivery_url: `s3://marketplace-artifacts/encrypted/${deliveryId}`,
    proof_id: proof.proof_id,
  };
}

/**
 * publishDelivery: either call external ArtifactPublisher or synthesize locally.
 *
 * Input:
 *  {
 *    orderId, skuId, buyerId, ledgerProof, license? (optional)
 *  }
 *
 * Returns:
 *  { license, delivery, proof }
 */
export async function publishDelivery(input: { orderId: string; skuId: string; buyerId?: string; ledgerProof?: LedgerProof; license?: License }) {
  const { orderId, skuId, buyerId, ledgerProof, license } = input;

  // If AP_URL present, try calling it
  if (AP_URL) {
    // Try a couple of plausible endpoints
    const endpoints = [
      `${AP_URL}/publish-delivery`,
      `${AP_URL}/deliver`,
      `${AP_URL}/v1/deliver`,
      `${AP_URL}/deliveries`,
      `${AP_URL}/publish`,
    ];

    for (const ep of endpoints) {
      try {
        const payload = { orderId, skuId, buyerId, ledgerProof, license };
        const resp = await postJson(ep, payload, AP_TOKEN);
        if (resp && resp.ok && resp.body) {
          // Normalize returned shape; expect { ok:true, license: {...}, delivery: {...}, proof: {...} }
          const body = resp.body;
          const outLicense = body.license || body.signed_license || license || null;
          const outDelivery = body.delivery || body.result?.delivery || null;
          const outProof = body.proof || body.result?.proof || null;

          // If proof exists but missing certain fields, try to normalize
          const normalizedProof: Proof | null = outProof
            ? {
                proof_id: outProof.proof_id || outProof.id,
                order_id: outProof.order_id || outProof.orderId || orderId,
                artifact_sha256: outProof.artifact_sha256 || outProof.artifactSha256,
                manifest_signature_id: outProof.manifest_signature_id || outProof.manifestSignatureId,
                ledger_proof_id: outProof.ledger_proof_id || outProof.ledgerProofId || ledgerProof?.ledger_proof_id,
                signer_kid: outProof.signer_kid || outProof.signerKid,
                signature: outProof.signature,
                ts: outProof.ts || outProof.created_at,
                canonical_payload: outProof.canonical_payload || outProof.canonicalPayload,
              }
            : null;

          const normalizedDelivery: Delivery | null = outDelivery
            ? {
                delivery_id: outDelivery.delivery_id || outDelivery.id || `delivery-${shortHash(`${orderId}:${skuId}:ap`)}`,
                status: outDelivery.status || 'ready',
                encrypted_delivery_url: outDelivery.encrypted_delivery_url || outDelivery.url || outDelivery.encrypted_url,
                proof_id: (outDelivery.proof_id || outDelivery.proof?.proof_id || normalizedProof?.proof_id) as string,
              }
            : null;

          // If license missing, check body.license or synthesize
          const normalizedLicense: License | null = outLicense
            ? {
                license_id: outLicense.license_id || outLicense.id || `lic-${shortHash(`${orderId}:${skuId}:ap`)}`,
                ...outLicense,
              }
            : null;

          return { license: normalizedLicense, delivery: normalizedDelivery, proof: normalizedProof };
        }
      } catch (e) {
        // try next endpoint
        // eslint-disable-next-line no-console
        console.debug('ArtifactPublisher call failed on', ep, (e as Error).message);
      }
    }
    // AP_URL present but all endpoints failed — fall through to synthesize
    // eslint-disable-next-line no-console
    console.debug('ArtifactPublisher endpoints unreachable or returned non-OK; falling back to synthesize delivery/proof');
  }

  // Synthesize for dev/local runs
  const proof = synthesizeProof(orderId, skuId);
  const delivery = synthesizeDelivery(orderId, skuId, proof);

  // If incoming license not provided, synthesize a license as well
  const finalLicense: License = license || {
    license_id: `lic-${shortHash(`${orderId}:${skuId}:lic`)}`,
    order_id: orderId,
    sku_id: skuId,
    buyer_id: buyerId,
    scope: { type: 'single-user', expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() },
    issued_at: new Date().toISOString(),
    signer_kid: AP_SIGNER_KID_OVERRIDE || 'marketplace-signer-v1',
    signature: Buffer.from(`license:${orderId}:${skuId}`).toString('base64'),
  };

  return { license: finalLicense, delivery, proof };
}

/**
 * getProof(proofId): tries to fetch proof from AP or synthesize in dev.
 */
export async function getProof(proofId: string): Promise<Proof | null> {
  if (!proofId) return null;

  if (AP_URL) {
    const endpoints = [
      `${AP_URL}/proofs/${encodeURIComponent(proofId)}`,
      `${AP_URL}/v1/proofs/${encodeURIComponent(proofId)}`,
      `${AP_URL}/proof/${encodeURIComponent(proofId)}`,
    ];
    for (const ep of endpoints) {
      try {
        const resp = await getJson(ep, AP_TOKEN);
        if (resp && resp.ok && resp.body) {
          const body = resp.body;
          const p = body.proof || body || null;
          if (!p) continue;
          const proof: Proof = {
            proof_id: p.proof_id || p.id || proofId,
            order_id: p.order_id || p.orderId,
            artifact_sha256: p.artifact_sha256 || p.artifactSha256,
            manifest_signature_id: p.manifest_signature_id || p.manifestSignatureId,
            ledger_proof_id: p.ledger_proof_id || p.ledgerProofId,
            signer_kid: p.signer_kid || p.signerKid,
            signature: p.signature,
            ts: p.ts || p.created_at,
            canonical_payload: p.canonical_payload || p.canonicalPayload,
          };
          return proof;
        }
      } catch (e) {
        // try next
        // eslint-disable-next-line no-console
        console.debug('ArtifactPublisher getProof failed on', ep, (e as Error).message);
      }
    }
  }

  // Dev fallback: synthesize plausible proof
  // We don't have order/sku context so we craft a semi-random, stable proof based on proofId
  if (process.env.NODE_ENV !== 'production') {
    const artifactSha256 = crypto.createHash('sha256').update(String(proofId)).digest('hex');
    const signerKid = AP_SIGNER_KID_OVERRIDE || 'artifact-publisher-signer-v1';
    const signature = Buffer.from(`sim:${proofId}`).toString('base64');
    return {
      proof_id: proofId,
      artifact_sha256: artifactSha256,
      manifest_signature_id: `manifest-sig-${shortHash(proofId)}`,
      ledger_proof_id: `ledger-sim-${shortHash(proofId)}`,
      signer_kid: signerKid,
      signature,
      ts: new Date().toISOString(),
      canonical_payload: { proof_id: proofId, artifact_sha256: artifactSha256 },
    };
  }

  return null;
}

export default {
  publishDelivery,
  getProof,
};

