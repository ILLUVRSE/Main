/**
 * kernel/src/signingProxy.ts
 *
 * Production-minded KMS signing proxy client for Kernel.
 *
 * - Uses KMS_ENDPOINT (required when REQUIRE_KMS=true) to sign manifests and arbitrary data.
 * - Supports Bearer token auth (KMS_BEARER_TOKEN) or mTLS auth via cert/key files (KMS_MTLS_CERT_PATH,
 *   KMS_MTLS_KEY_PATH). If both are provided, mTLS is preferred.
 * - If REQUIRE_KMS is true and KMS_ENDPOINT is missing/unreachable -> throws (fail-fast).
 * - Local ephemeral Ed25519 fallback only used when REQUIRE_KMS !== 'true' and KMS is missing/unavailable.
 *
 * NOTE: DO NOT COMMIT SECRETS. Use host secret manager for KMS creds/certs and POSTGRES_URL, etc.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import fetch from 'node-fetch';
import { ManifestSignature } from './types';

const KMS_ENDPOINT = (process.env.KMS_ENDPOINT || '').replace(/\/$/, '');
const SIGNER_ID = process.env.SIGNER_ID || 'kernel-signer-local';
const REQUIRE_KMS = (process.env.REQUIRE_KMS || 'false').toLowerCase() === 'true';

// Optional auth for KMS
const KMS_BEARER_TOKEN = process.env.KMS_BEARER_TOKEN || '';
const KMS_MTLS_CERT_PATH = process.env.KMS_MTLS_CERT_PATH || '';
const KMS_MTLS_KEY_PATH = process.env.KMS_MTLS_KEY_PATH || '';
const KMS_TIMEOUT_MS = Number(process.env.KMS_TIMEOUT_MS || 5000);

/**
 * canonicalizePayload
 * Stable JSON canonicalization: sort object keys recursively so signatures are deterministic.
 */
function canonicalizePayload(obj: any): string {
  const normalize = (o: any): any => {
    if (o === null || typeof o !== 'object') return o;
    if (Array.isArray(o)) return o.map(normalize);
    const out: any = {};
    for (const k of Object.keys(o).sort()) {
      out[k] = normalize(o[k]);
    }
    return out;
  };
  return JSON.stringify(normalize(obj));
}

/**
 * createHttpsAgentIfNeeded
 * If mtls cert/key are provided, create an https.Agent for mutual TLS.
 */
function createHttpsAgentIfNeeded(): https.Agent | undefined {
  try {
    if (KMS_MTLS_CERT_PATH && KMS_MTLS_KEY_PATH) {
      const cert = fs.readFileSync(path.resolve(KMS_MTLS_CERT_PATH));
      const key = fs.readFileSync(path.resolve(KMS_MTLS_KEY_PATH));
      return new https.Agent({ cert, key, keepAlive: true });
    }
  } catch (err) {
    console.warn('signingProxy: failed to read mTLS cert/key:', (err as Error).message || err);
  }
  return undefined;
}

/**
 * httpPostJson
 * Helper to call KMS endpoints with optional auth/mTLS and timeout.
 */
async function httpPostJson(url: string, body: any): Promise<any> {
  if (!KMS_ENDPOINT) throw new Error('KMS_ENDPOINT not configured');
  const agent = createHttpsAgentIfNeeded();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (KMS_BEARER_TOKEN) headers['Authorization'] = `Bearer ${KMS_BEARER_TOKEN}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), KMS_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      agent,
      signal: controller.signal as any,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '<no body>');
      throw new Error(`KMS error ${res.status}: ${txt}`);
    }
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

/**
 * Local fallback signing (dev only)
 * Generate an ephemeral ed25519 keypair and sign payload. Returns base64 signature and signerId.
 * WARNING: ephemeral keys must NOT be used in production.
 */
function localEphemeralSign(payload: string): { signature: string; signerId: string } {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const sig = crypto.sign(null as any, Buffer.from(payload), privateKey).toString('base64');
  return { signature: sig, signerId: SIGNER_ID };
}

/**
 * Map KMS response to ManifestSignature canonical shape.
 * Adapt to your KMS response contract if it differs.
 */
function mapKmsManifestResponse(body: any, manifestId: string, ts: string): ManifestSignature {
  return {
    id: body.id ?? crypto.randomUUID(),
    manifest_id: body.manifest_id ?? body.manifestId ?? manifestId,
    signer_id: body.signer_id ?? body.signerId ?? SIGNER_ID,
    signature: body.signature ?? body.sig ?? '',
    version: body.version ?? body.key_version ?? undefined,
    ts: body.ts ?? ts,
    prev_hash: body.prev_hash ?? body.prevHash ?? null,
  } as any; // allow both snake_case and camelCase from KMS; cast to ManifestSignature
}

/**
 * signManifest
 * Primary method used by the Kernel to request a manifest signature.
 * - If KMS configured, call KMS_ENDPOINT + '/sign' with { signerId, payload, manifestId }.
 * - If KMS disabled/unreachable and REQUIRE_KMS=true -> throw.
 * - If KMS disabled/unreachable and REQUIRE_KMS=false -> fallback to local ephemeral sign (dev only).
 */
export async function signManifest(manifest: any): Promise<ManifestSignature> {
  const ts = new Date().toISOString();
  const manifestId = manifest?.id ?? `manifest-${crypto.randomUUID()}`;
  const payload = canonicalizePayload({ manifest, ts });

  if (KMS_ENDPOINT) {
    try {
      const url = `${KMS_ENDPOINT}/sign`;
      const body = { signerId: SIGNER_ID, payload, manifestId };
      const res = await httpPostJson(url, body);
      // Map and return
      const mapped = mapKmsManifestResponse(res, manifestId, ts);
      // Normalize keys to camelCase to satisfy rest of codebase (Types use camelCase)
      const sig: ManifestSignature = {
        id: String(mapped.id),
        manifestId: (mapped as any).manifest_id ?? (mapped as any).manifestId,
        signerId: (mapped as any).signer_id ?? (mapped as any).signerId ?? SIGNER_ID,
        signature: mapped.signature,
        version: mapped.version,
        ts: mapped.ts,
        prevHash: mapped.prev_hash ?? (mapped as any).prevHash ?? null,
      };
      return sig;
    } catch (err) {
      const msg = (err as Error).message || err;
      console.error('signingProxy: KMS signManifest failed:', msg);
      if (REQUIRE_KMS) {
        throw new Error(`KMS signing failed and REQUIRE_KMS=true: ${msg}`);
      }
      console.warn('signingProxy: falling back to local ephemeral signing (dev only)');
      const { signature, signerId } = localEphemeralSign(payload);
      return {
        id: `sig-${crypto.randomUUID()}`,
        manifestId,
        signerId,
        signature,
        version: manifest?.version ?? '1.0.0',
        ts,
        prevHash: null,
      };
    }
  }

  // No KMS endpoint configured
  if (REQUIRE_KMS) {
    throw new Error('REQUIRE_KMS=true but KMS_ENDPOINT is not configured');
  }

  // Developer fallback
  const { signature, signerId } = localEphemeralSign(payload);
  return {
    id: `sig-${crypto.randomUUID()}`,
    manifestId,
    signerId,
    signature,
    version: manifest?.version ?? '1.0.0',
    ts,
    prevHash: null,
  };
}

/**
 * signData
 * Sign arbitrary string data. Calls KMS_ENDPOINT + '/signData' if configured, similar semantics to signManifest.
 */
export async function signData(data: string): Promise<{ signature: string; signerId: string }> {
  const ts = new Date().toISOString();
  const payload = canonicalizePayload({ data, ts });

  if (KMS_ENDPOINT) {
    try {
      const url = `${KMS_ENDPOINT}/signData`;
      const body = { signerId: SIGNER_ID, data: payload };
      const res = await httpPostJson(url, body);
      // Expect response { signature, signerId? }
      return { signature: res.signature, signerId: res.signerId ?? res.signer_id ?? SIGNER_ID };
    } catch (err) {
      const msg = (err as Error).message || err;
      console.error('signingProxy: KMS signData failed:', msg);
      if (REQUIRE_KMS) throw new Error(`KMS signData failed and REQUIRE_KMS=true: ${msg}`);
      console.warn('signingProxy: falling back to local ephemeral signing (dev only)');
      return localEphemeralSign(payload);
    }
  }

  if (REQUIRE_KMS) {
    throw new Error('REQUIRE_KMS=true but KMS_ENDPOINT is not configured');
  }

  return localEphemeralSign(payload);
}

/**
 * Exported proxy object
 */
const signingProxy = {
  signManifest,
  signData,
  // expose config for testing/inspection
  _internal: {
    KMS_ENDPOINT,
    SIGNER_ID,
    REQUIRE_KMS,
    KMS_BEARER_TOKEN: !!KMS_BEARER_TOKEN,
    KMS_MTLS_CERT_PATH,
    KMS_MTLS_KEY_PATH,
  },
};

export default signingProxy;

/**
 * Acceptance criteria (short, testable):
 *
 * - When KMS_ENDPOINT is configured and reachable, signManifest calls KMS /sign and returns a ManifestSignature
 *   that includes id, manifestId, signerId, signature (base64), version, ts, prevHash.
 *   Test: Start a mock HTTP server that responds to /sign with expected fields and assert signManifest returns mapped fields.
 *
 * - When REQUIRE_KMS=true and KMS_ENDPOINT is missing or KMS returns error, signManifest and signData throw.
 *   Test: set REQUIRE_KMS=true, unset KMS_ENDPOINT, call signManifest -> expect thrown error.
 *
 * - When REQUIRE_KMS is false/unset and KMS is not configured, signManifest and signData perform local ephemeral Ed25519 signing
 *   and return base64 signature (dev only). Test: unset REQUIRE_KMS and KMS_ENDPOINT and assert signManifest returns signature.
 *
 * - mTLS support: When KMS_MTLS_CERT_PATH and KMS_MTLS_KEY_PATH point to cert/key files, httpPostJson will use an https.Agent
 *   with the provided cert/key so the KMS can require client cert authentication. Test: run a mock TLS server requiring client cert and verify call succeeds.
 *
 * - Bearer token support: When KMS_BEARER_TOKEN is configured, Authorization: Bearer <token> is sent in requests.
 *
 * Security note: never rely on local ephemeral signing in production; ensure KMS is used and rails enforce REQUIRE_KMS=true in production CI/CD.
 *
 * Next file to update after saving this: kernel/src/routes/kernelRoutes.ts (apply RBAC and Sentinel policy enforcement).
 */

