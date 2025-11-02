/**
 * kernel/src/signingProxy.ts
 *
 * KMS / signing proxy client for Kernel.
 * - Uses KMS_ENDPOINT + SIGNER_ID when configured.
 * - Falls back to local ephemeral Ed25519 key for dev (NOT for production).
 *
 * Responsibility:
 * - signManifest(manifest): returns a ManifestSignature-like record.
 * - signData(data): returns { signature, signerId } for arbitrary data.
 *
 * Notes:
 * - DO NOT COMMIT SECRETS — use Vault/KMS and environment variables for DB/keys.
 * - Replace the remote contract/response parsing below to match your KMS API.
 */

import fetch from 'node-fetch';
import crypto from 'crypto';
import { ManifestSignature } from './types';

const KMS_ENDPOINT = process.env.KMS_ENDPOINT || '';
const SIGNER_ID = process.env.SIGNER_ID || 'kernel-signer-local';

/**
 * canonicalizePayload
 * Ensure deterministic JSON for signing (simple stable stringify).
 * For more strict canonicalization, replace with a canonical JSON library.
 */
function canonicalizePayload(obj: any): string {
  const sorted = (o: any): any => {
    if (o === null || typeof o !== 'object') return o;
    if (Array.isArray(o)) return o.map(sorted);
    const keys = Object.keys(o).sort();
    const out: any = {};
    for (const k of keys) out[k] = sorted(o[k]);
    return out;
  };
  return JSON.stringify(sorted(obj));
}

/**
 * signWithLocalKey
 * Generates ephemeral ed25519 keypair and signs the payload.
 * WARNING: Ephemeral keys are only for dev/test and should never be used in prod.
 */
function signWithLocalKey(payload: string): { signature: string; signerId: string } {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const sig = crypto.sign(null as any, Buffer.from(payload), privateKey).toString('base64');
  return { signature: sig, signerId: SIGNER_ID };
}

/**
 * signManifest
 * Calls KMS endpoint if configured; otherwise falls back to ephemeral local signing.
 *
 * Expected remote KMS sign contract (example):
 * POST ${KMS_ENDPOINT}/sign
 * body: { signerId, payload, manifestId? }
 * response: { id, manifest_id, signer_id, signature, version, ts, prev_hash }
 *
 * The returned ManifestSignature uses keys: id, manifestId, signerId, signature, version, ts, prevHash
 */
export async function signManifest(manifest: any): Promise<ManifestSignature> {
  const ts = new Date().toISOString();
  const manifestId = manifest?.id ?? `manifest-${crypto.randomUUID()}`;
  const payload = canonicalizePayload({ manifest, ts });

  if (KMS_ENDPOINT) {
    try {
      const url = `${KMS_ENDPOINT.replace(/\/$/, '')}/sign`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerId: SIGNER_ID, payload, manifestId }),
      });
      if (!res.ok) {
        throw new Error(`KMS sign failed: ${res.status} ${res.statusText}`);
      }
      const body = await res.json();
      // Map KMS response to local ManifestSignature shape.
      // Adapt mapping if your KMS response uses different fields.
      const sig: ManifestSignature = {
        id: body.id ?? crypto.randomUUID(),
        manifestId: body.manifest_id ?? body.manifestId ?? manifestId,
        signerId: body.signer_id ?? body.signerId ?? SIGNER_ID,
        signature: body.signature,
        version: body.version ?? manifest?.version ?? '1.0.0',
        ts: body.ts ?? ts,
        prevHash: body.prev_hash ?? body.prevHash ?? null,
      };
      return sig;
    } catch (err) {
      // Log and fall through to local signing fallback
      console.error('KMS sign error, falling back to local signing:', (err as Error).message || err);
    }
  }

  // Local fallback signing (dev only)
  const { signature, signerId } = signWithLocalKey(payload);
  const localSig: ManifestSignature = {
    id: crypto.randomUUID(),
    manifestId,
    signerId,
    signature,
    version: manifest?.version ?? '1.0.0',
    ts,
    prevHash: null,
  };
  return localSig;
}

/**
 * signData
 * Sign arbitrary string data. Uses KMS if configured, otherwise uses ephemeral local key.
 * Returns { signature, signerId } where signature is base64.
 */
export async function signData(data: string): Promise<{ signature: string; signerId: string }> {
  const payload = canonicalizePayload({ data, ts: new Date().toISOString() });

  if (KMS_ENDPOINT) {
    try {
      const url = `${KMS_ENDPOINT.replace(/\/$/, '')}/signData`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerId: SIGNER_ID, data: payload }),
      });
      if (!res.ok) throw new Error(`KMS signData failed: ${res.status} ${res.statusText}`);
      const body = await res.json();
      return { signature: body.signature, signerId: body.signerId ?? SIGNER_ID };
    } catch (err) {
      console.error('KMS signData error, falling back to local signing:', (err as Error).message || err);
    }
  }

  // Local fallback
  return signWithLocalKey(payload);
}

/**
 * Default export: convenient proxy object
 */
const signingProxy = {
  signManifest,
  signData,
};

export default signingProxy;

/**
 * Acceptance criteria (testable)
 *
 * - signManifest returns a ManifestSignature with fields: id, manifestId, signerId, signature, version, ts.
 *   Test: Call signManifest({ id: 'm1', ... }) with no KMS and assert returned object has those fields and signature is base64.
 *
 * - When KMS_ENDPOINT is set and the KMS responds 200 with expected fields, signManifest should return the mapped KMS response.
 *   Test: Start a mock HTTP server that implements /sign and verify the mapping.
 *
 * - signData returns signature and signerId and works both with and without KMS_ENDPOINT.
 *   Test: Call signData('hello') and verify signature is present and base64-decodable.
 *
 * - canonicalizePayload produces stable JSON for identical inputs (keys sorted).
 *   Test: canonicalizePayload({b:2,a:1}) === canonicalizePayload({a:1,b:2})
 *
 * - Security note: local ephemeral signing must not be used in production. Ensure REQUIRE_KMS or equivalent policy is enforced by CI/ops when deploying.
 */

