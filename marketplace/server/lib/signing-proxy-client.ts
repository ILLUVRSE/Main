/**
 * marketplace/server/lib/signing-proxy-client.ts
 *
 * Lightweight client to call a signing-proxy offering:
 *  - POST /sign   { digest_hex | canonical_payload, algorithm? } -> { signature: base64, signer_kid, algorithm? }
 *  - POST /verify { digest_hex | canonical_payload, signature_b64 } -> { verified: true|false }
 *
 * Env:
 *  - SIGNING_PROXY_URL (required by functions)
 *  - SIGNING_PROXY_API_KEY (optional bearer token)
 */

import fetch from 'cross-fetch';

type SignResponse = {
  signature: string; // base64
  signer_kid?: string;
  algorithm?: string;
};

type VerifyResponse = {
  verified: boolean;
  details?: any;
};

function getProxyUrl(): string {
  const u = process.env.SIGNING_PROXY_URL || '';
  if (!u) throw new Error('Signing proxy URL not configured (SIGNING_PROXY_URL)');
  return u.replace(/\/$/, '');
}

function getAuthHeader(): Record<string, string> {
  const apiKey = process.env.SIGNING_PROXY_API_KEY;
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

async function postJson<T = any>(path: string, body: any, timeoutMs = 15000): Promise<T> {
  const base = getProxyUrl();
  const url = `${base}${path.startsWith('/') ? path : '/' + path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
  };

  // Basic fetch with timeout via AbortController
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // non-json response
      throw new Error(`Signing proxy returned non-JSON response (${resp.status}): ${text}`);
    }
    if (!resp.ok) {
      // include body in error
      throw new Error(`Signing proxy ${url} responded ${resp.status}: ${JSON.stringify(json)}`);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * signDigest: ask proxy to sign a digest (hex string)
 */
export async function signDigest(digestHex: string, algorithm?: string): Promise<SignResponse> {
  if (!digestHex) throw new Error('digestHex is required');
  const body: any = { digest_hex: digestHex };
  if (algorithm) body.algorithm = algorithm;
  const resp = await postJson<any>('/sign', body);
  if (!resp || (!resp.signature && !resp.signature_b64 && !resp.signatureB64)) {
    throw new Error('Signing proxy returned unexpected response (no signature)');
  }
  return {
    signature: resp.signature || resp.signature_b64 || resp.signatureB64,
    signer_kid: resp.signer_kid || resp.signerKid || resp.signer,
    algorithm: resp.algorithm || algorithm,
  };
}

/**
 * signCanonical: sign a canonical payload string
 */
export async function signCanonical(canonicalPayload: string, algorithm?: string): Promise<SignResponse> {
  if (typeof canonicalPayload !== 'string') {
    // Accept objects by canonicalizing externally; this client expects a string payload
    throw new Error('canonicalPayload must be a string');
  }
  const body: any = { canonical_payload: canonicalPayload };
  if (algorithm) body.algorithm = algorithm;
  const resp = await postJson<any>('/sign', body);
  if (!resp || (!resp.signature && !resp.signature_b64 && !resp.signatureB64)) {
    throw new Error('Signing proxy returned unexpected response (no signature)');
  }
  return {
    signature: resp.signature || resp.signature_b64 || resp.signatureB64,
    signer_kid: resp.signer_kid || resp.signerKid || resp.signer,
    algorithm: resp.algorithm || algorithm,
  };
}

/**
 * verifyDigest: verify a signature against a digest hex
 */
export async function verifyDigest(digestHex: string, signatureB64: string): Promise<VerifyResponse> {
  if (!digestHex) throw new Error('digestHex is required');
  if (!signatureB64) throw new Error('signatureB64 is required');
  const body = { digest_hex: digestHex, signature_b64: signatureB64 };
  const resp = await postJson<any>('/verify', body);
  if (typeof resp.verified === 'undefined') {
    throw new Error(`Signing proxy verify returned unexpected response: ${JSON.stringify(resp)}`);
  }
  return { verified: Boolean(resp.verified), details: resp };
}

/**
 * verifyCanonical: verify a signature against a canonical payload string
 */
export async function verifyCanonical(canonicalPayload: string, signatureB64: string): Promise<VerifyResponse> {
  if (typeof canonicalPayload !== 'string') throw new Error('canonicalPayload must be a string');
  if (!signatureB64) throw new Error('signatureB64 is required');
  const body = { canonical_payload: canonicalPayload, signature_b64: signatureB64 };
  const resp = await postJson<any>('/verify', body);
  if (typeof resp.verified === 'undefined') {
    throw new Error(`Signing proxy verify returned unexpected response: ${JSON.stringify(resp)}`);
  }
  return { verified: Boolean(resp.verified), details: resp };
}

export default {
  signDigest,
  signCanonical,
  verifyDigest,
  verifyCanonical,
};

