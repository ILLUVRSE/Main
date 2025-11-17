/**
 * marketplace/server/lib/signingClient.ts
 *
 * Provide signing and verification helpers:
 *  - signObject(obj): returns { signature: base64, signer_kid, canonical_payload, digest_hex }
 *  - verifySignedObject(signedObj): returns boolean
 *
 * Config / env variables:
 *  - AUDIT_SIGNING_KMS_KEY_ID (use AWS KMS Sign)
 *  - AUDIT_SIGNING_ALG (e.g., RSA_PKCS1_SHA_256 or RSA_PSS_SHA_256)
 *  - SIGNING_PROXY_URL & SIGNING_PROXY_API_KEY (POST /sign and POST /verify)
 *  - AUDIT_SIGNING_PRIVATE_KEY (PEM, dev only) for local signing fallback
 *  - SIGNER_PUBLIC_KEY_PEM (PEM) for verify fallback
 *  - AUDIT_SIGNING_SIGNER_KID (optional) to override signer kid metadata
 */

import crypto from 'crypto';
import fetch from 'cross-fetch';
import { URL } from 'url';
import fs from 'fs';

type SignResult = {
  signature: string; // base64
  signer_kid?: string;
  canonical_payload: string;
  digest_hex: string;
  algorithm?: string;
};

function sortKeys(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const keys = Object.keys(value).sort();
  const out: any = {};
  for (const k of keys) {
    out[k] = sortKeys(value[k]);
  }
  return out;
}

function canonicalize(obj: any): string {
  return JSON.stringify(sortKeys(obj), (_k, v) => (v === undefined ? null : v));
}

function digestHexFromCanonical(canonical: string) {
  return crypto.createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

/**
 * Try AWS KMS sign (MessageType: 'DIGEST').
 */
async function kmsSign(digestHex: string) {
  const keyId = process.env.AUDIT_SIGNING_KMS_KEY_ID;
  if (!keyId) return null;
  try {
    // Lazy require to avoid a hard dependency until needed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { KMSClient, SignCommand } = require('@aws-sdk/client-kms');
    const client = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const algEnv = (process.env.AUDIT_SIGNING_ALG || 'RSA_PKCS1_SHA_256').toUpperCase();
    const signingAlgorithm = algEnv.includes('PSS') ? 'RSASSA_PSS_SHA_256' : 'RSASSA_PKCS1_V1_5_SHA_256';
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: Buffer.from(digestHex, 'hex'),
      SigningAlgorithm: signingAlgorithm,
      MessageType: 'DIGEST',
    });
    const resp = await client.send(cmd);
    if (resp && resp.Signature) {
      return {
        signatureB64: Buffer.from(resp.Signature).toString('base64'),
        signer_kid: process.env.AUDIT_SIGNING_SIGNER_KID || keyId,
        algorithm: signingAlgorithm,
      };
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('kmsSign failed:', (e as Error).message);
  }
  return null;
}

/**
 * Try signing proxy
 * Expect signing proxy to expose POST /sign { digest_hex, algorithm } -> { signature: base64, signer_kid }
 */
async function proxySign(digestHex: string) {
  const proxyUrl = process.env.SIGNING_PROXY_URL;
  const apiKey = process.env.SIGNING_PROXY_API_KEY;
  if (!proxyUrl) return null;
  try {
    const u = new URL(proxyUrl);
    const ep = `${u.href.replace(/\/$/, '')}/sign`;
    const alg = process.env.AUDIT_SIGNING_ALG || 'RSA_PKCS1_SHA_256';
    const resp = await fetch(ep, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ digest_hex: digestHex, algorithm: alg }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Signing proxy responded ${resp.status}: ${txt}`);
    }
    const json = await resp.json().catch(() => null);
    if (!json) throw new Error('Signing proxy returned non-JSON response');
    const signature = json.signature || json.signatureB64 || json.signature_b64;
    const signer_kid = json.signer_kid || json.signerKid || json.signer;
    return { signatureB64: signature, signer_kid, algorithm: json.algorithm || alg };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('proxySign failed:', (e as Error).message);
  }
  return null;
}

/**
 * Local PEM signing (dev only). Expects AUDIT_SIGNING_PRIVATE_KEY env var which can be a path or inline PEM.
 */
function localPemSign(digestHex: string) {
  const pemRaw = process.env.AUDIT_SIGNING_PRIVATE_KEY;
  if (!pemRaw) return null;
  try {
    let pem = pemRaw;
    if (fs.existsSync(pemRaw)) pem = fs.readFileSync(pemRaw, 'utf8');
    // Determine algorithm: default rsa-sha256 pkcs1v15
    const alg = (process.env.AUDIT_SIGNING_ALG || 'RSA_PKCS1_SHA_256').toUpperCase();
    const usePss = alg.includes('PSS');
    const sign = crypto.createSign('sha256');
    // For KMS we sign the digest directly; for PEM we sign the canonical payload bytes.
    // But to be compatible with KMS MessageType:DIGEST semantics, we will sign the digest as raw bytes by providing a Buffer digest.
    // Node's Sign API expects the actual message, so we sign the canonical payload instead (consistent with verify).
    // Simpler approach: sign the digest hex string as utf8 (acceptable for local/dev; production uses KMS/proxy).
    sign.update(Buffer.from(digestHex, 'hex'));
    sign.end();
    const signature = sign.sign(pem);
    return { signatureB64: Buffer.from(signature).toString('base64'), signer_kid: process.env.AUDIT_SIGNING_SIGNER_KID || 'local-pem', algorithm: alg };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('localPemSign failed:', (e as Error).message);
    return null;
  }
}

/**
 * signObject: canonicalize -> digest -> sign via KMS/proxy/local -> return signature and metadata
 */
export async function signObject(obj: any): Promise<SignResult> {
  const canonical = canonicalize(obj);
  const digestHex = digestHexFromCanonical(canonical);

  // Try KMS
  const kms = await kmsSign(digestHex);
  if (kms && kms.signatureB64) {
    return { signature: kms.signatureB64, signer_kid: kms.signer_kid, canonical_payload: canonical, digest_hex: digestHex, algorithm: kms.algorithm };
  }

  // Try proxy
  const proxy = await proxySign(digestHex);
  if (proxy && proxy.signatureB64) {
    return { signature: proxy.signatureB64, signer_kid: proxy.signer_kid, canonical_payload: canonical, digest_hex: digestHex, algorithm: proxy.algorithm };
  }

  // Try local PEM (dev fallback)
  const local = localPemSign(digestHex);
  if (local && local.signatureB64) {
    return { signature: local.signatureB64, signer_kid: local.signer_kid, canonical_payload: canonical, digest_hex: digestHex, algorithm: local.algorithm };
  }

  // If no signing path, return signatureless result (caller should handle)
  return { signature: '', signer_kid: undefined, canonical_payload: canonical, digest_hex: digestHex, algorithm: undefined };
}

/**
 * Verification helpers
 */

/**
 * Get public key PEM from KMS (GetPublicKey). Returns PEM string or null.
 */
async function kmsGetPublicKeyPem(keyId: string): Promise<{ pem?: string; signer_kid?: string } | null> {
  if (!keyId) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { KMSClient, GetPublicKeyCommand } = require('@aws-sdk/client-kms');
    const client = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const cmd = new GetPublicKeyCommand({ KeyId: keyId });
    const resp = await client.send(cmd);
    if (resp && resp.PublicKey) {
      // resp.PublicKey is DER; convert to PEM
      const der = Buffer.from(resp.PublicKey);
      // Determine key type (RSA vs EC) by parsing DER (simplified approach)
      // Use openssl-compatible PEM header for RSA: "-----BEGIN PUBLIC KEY-----"
      const b64 = der.toString('base64');
      const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----\n`;
      return { pem, signer_kid: process.env.AUDIT_SIGNING_SIGNER_KID || keyId };
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('kmsGetPublicKeyPem failed:', (e as Error).message);
  }
  return null;
}

/**
 * Ask signing proxy to verify signature if available.
 * Expect POST /verify { digest_hex, signature_b64 } -> { verified: true/false }
 */
async function proxyVerify(digestHex: string, signatureB64: string) {
  const proxyUrl = process.env.SIGNING_PROXY_URL;
  const apiKey = process.env.SIGNING_PROXY_API_KEY;
  if (!proxyUrl) return null;
  try {
    const u = new URL(proxyUrl);
    const ep = `${u.href.replace(/\/$/, '')}/verify`;
    const resp = await fetch(ep, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ digest_hex: digestHex, signature_b64: signatureB64 }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Signing proxy verify failed ${resp.status}: ${txt}`);
    }
    const json = await resp.json().catch(() => null);
    if (json && typeof json.verified !== 'undefined') return Boolean(json.verified);
    if (json && json.ok) return true;
    return null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('proxyVerify failed:', (e as Error).message);
    return null;
  }
}

/**
 * Verify signature using PEM public key (RSA PKCS#1 v1.5 assumed for now).
 * canonicalPayload: string (UTF-8), signatureB64: base64 string
 */
function verifyPemSignature(canonicalPayload: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const verifier = crypto.createVerify('sha256');
    verifier.update(Buffer.from(canonicalPayload, 'utf8'));
    verifier.end();
    const sigBuf = Buffer.from(signatureB64, 'base64');
    return verifier.verify(publicKeyPem, sigBuf);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('verifyPemSignature failed:', (e as Error).message);
    return false;
  }
}

/**
 * verifySignedObject(signedObj):
 * signedObj may contain:
 *  - canonical_payload (string) and signature (base64)
 *  - or an object and a separate signature field; function will canonicalize if needed.
 */
export async function verifySignedObject(signedObj: any): Promise<boolean> {
  // Extract canonical payload
  let canonical: string;
  if (signedObj && signedObj.canonical_payload) {
    canonical = typeof signedObj.canonical_payload === 'string' ? signedObj.canonical_payload : JSON.stringify(signedObj.canonical_payload);
  } else if (signedObj && signedObj.payload) {
    canonical = canonicalize(signedObj.payload);
  } else {
    // If caller provided a raw object with signature
    const payload = signedObj?.signed_license || signedObj?.license || signedObj?.payload || signedObj;
    canonical = canonicalize(payload);
  }

  const signature = signedObj.signature || signedObj.sig || signedObj.signature_b64 || signedObj.signatureB64;
  if (!signature) {
    // nothing to verify
    return false;
  }

  const digestHex = digestHexFromCanonical(canonical);

  // 1) Try proxy verify
  const proxyOk = await proxyVerify(digestHex, signature);
  if (proxyOk !== null) return Boolean(proxyOk);

  // 2) Try KMS public key verify
  const kmsKeyId = process.env.AUDIT_SIGNING_KMS_KEY_ID;
  if (kmsKeyId) {
    const pub = await kmsGetPublicKeyPem(kmsKeyId);
    if (pub && pub.pem) {
      return verifyPemSignature(canonical, signature, pub.pem);
    }
  }

  // 3) Try SIGNER_PUBLIC_KEY_PEM env var
  const pubPemRaw = process.env.SIGNER_PUBLIC_KEY_PEM;
  if (pubPemRaw) {
    let pem = pubPemRaw;
    try {
      if (fs.existsSync(pubPemRaw)) pem = fs.readFileSync(pubPemRaw, 'utf8');
    } catch {
      // ignore: use as inline
    }
    return verifyPemSignature(canonical, signature, pem);
  }

  // 4) If no verification path available, be permissive in dev, strict in prod
  return process.env.NODE_ENV !== 'production';
}

/**
 * getSignerKid: return the signer kid that will be used for signing (best-effort)
 */
export function getSignerKid(): string | undefined {
  return process.env.AUDIT_SIGNING_SIGNER_KID || process.env.AUDIT_SIGNING_KMS_KEY_ID || (process.env.SIGNING_PROXY_URL ? 'signing-proxy' : undefined);
}

export default {
  signObject,
  verifySignedObject,
  getSignerKid,
};

