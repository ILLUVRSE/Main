/**
 * memory-layer/service/audit/signingProxyClient.ts
 *
 * Lightweight client for a remote signing proxy (optional).
 *
 * The signing proxy is an HTTP service that performs signing/verification on behalf
 * of the application (useful if you have a centralized HSM/signing service).
 *
 * Environment:
 *  - SIGNING_PROXY_URL        (required to enable this client, e.g. https://signer.example.local)
 *  - SIGNING_PROXY_API_KEY    (optional, sent as Authorization: Bearer <key>)
 *
 * Expected proxy endpoints (JSON):
 *  POST /sign/canonical   { canonical: string } -> { kid, alg, signature }
 *  POST /sign/hash        { digest_hex: string } -> { kid, alg, signature }
 *  POST /verify           { digest_hex: string, signature: string } -> { valid: boolean }
 *
 * This module is a thin wrapper — it does not implement retry logic; callers
 * should handle retries if desired. It throws on transport or proxy errors.
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const proxyUrl = process.env.SIGNING_PROXY_URL?.trim();
const proxyApiKey = process.env.SIGNING_PROXY_API_KEY ?? undefined;

if (!proxyUrl) {
  // module can still be imported in environments without a signing proxy; functions will throw if used.
  // No action required here.
}

/** Minimal helper to POST JSON and parse response. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!proxyUrl) {
    throw new Error('SIGNING_PROXY_URL is not configured');
  }
  const base = new URL(proxyUrl);
  // ensure path starts with '/'
  const full = new URL(path.startsWith('/') ? path : `/${path}`, base).toString();
  const parsed = new URL(full);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  const json = JSON.stringify(body);
  const opts: (https.RequestOptions | http.RequestOptions) = {
    method: 'POST',
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    path: parsed.pathname + (parsed.search ?? ''),
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(json),
      accept: 'application/json'
    },
    timeout: 30_000
  };

  if (proxyApiKey) {
    // Bearer token auth
    (opts.headers as Record<string, string>)['authorization'] = `Bearer ${proxyApiKey}`;
  }

  return new Promise<T>((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          return reject(new Error(`signing-proxy ${parsed.pathname} responded ${status}: ${data}`));
        }
        try {
          const parsedJson = data ? JSON.parse(data) : {};
          resolve(parsedJson as T);
        } catch (err) {
          reject(new Error(`invalid json from signing-proxy: ${(err as Error).message}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
    req.write(json);
    req.end();
  });
}

/** Sign canonical message (message path) */
export async function signAuditCanonical(canonical: string): Promise<{ kid: string; alg: string; signature: string }> {
  if (!canonical) throw new Error('canonical message required');
  return postJson<{ kid: string; alg: string; signature: string }>('/sign/canonical', { canonical });
}

/** Sign precomputed digest (digest path) - digestHex is a lowercase hex string */
export async function signAuditHash(digestBuf: Buffer): Promise<{ kid: string; alg: string; signature: string }> {
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  const digestHex = digestBuf.toString('hex');
  return postJson<{ kid: string; alg: string; signature: string }>('/sign/hash', { digest_hex: digestHex });
}

/** Verify signature against precomputed digest */
export async function verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean> {
  if (!signatureBase64) throw new Error('signature required');
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  const digestHex = digestBuf.toString('hex');
  const resp = await postJson<{ valid: boolean }>('/verify', { digest_hex: digestHex, signature: signatureBase64 });
  return Boolean(resp?.valid);
}

export default {
  signAuditCanonical,
  signAuditHash,
  verifySignature
};

