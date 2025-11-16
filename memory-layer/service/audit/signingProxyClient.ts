/**
 * memory-layer/service/audit/signingProxyClient.ts
 *
 * Thin HTTP client for a remote signing proxy. This module intentionally
 * avoids ESM-only dependencies and uses the Node http/https APIs for max compatibility.
 *
 * Expected proxy endpoints (JSON):
 *  POST /sign/canonical   { canonical: string } -> { kid, alg, signature }
 *  POST /sign/hash        { digest_hex: string } -> { kid, alg, signature }
 *  POST /verify           { digest_hex: string, signature: string } -> { valid: boolean }
 *
 * Environment:
 *  - SIGNING_PROXY_URL        (required to enable this client, e.g. https://signer.example.local)
 *  - SIGNING_PROXY_API_KEY    (optional, sent as Authorization: Bearer <key>)
 *
 * Use:
 *  - signAuditCanonical(canonical)
 *  - signAuditHash(digestBuf)
 *  - verifySignature(signatureBase64, digestBuf)
 *
 * Notes:
 *  - Request/response JSON is assumed. Throws on HTTP errors.
 *  - Timeout defaults are conservative (30s).
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { Buffer } from 'buffer';

const proxyUrl = (process.env.SIGNING_PROXY_URL || '').trim();
const proxyApiKey = process.env.SIGNING_PROXY_API_KEY ?? undefined;

if (!proxyUrl) {
  // module can still be imported; calls will throw if used and no proxy configured.
}

/** Generic POST JSON helper using node http/https */
async function postJson<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  if (!proxyUrl) throw new Error('SIGNING_PROXY_URL is not configured');
  const base = new URL(proxyUrl);
  // Build full URL (preserve path)
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
    timeout: timeoutMs
  };

  if (proxyApiKey) {
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
          const msg = `signing-proxy ${parsed.pathname} responded ${status}: ${data}`;
          return reject(new Error(msg));
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

/** Sign canonical payload (message path) */
export async function signAuditCanonical(canonical: string): Promise<{ kid: string; alg: string; signature: string }> {
  if (!canonical) throw new Error('canonical required');
  const resp = await postJson<{ kid: string; alg: string; signature: string }>('/sign/canonical', { canonical });
  if (!resp || !resp.signature) throw new Error('signing proxy returned no signature');
  return resp;
}

/** Sign precomputed digest (digestBuf) - returns kid/alg/signature */
export async function signAuditHash(digestBuf: Buffer): Promise<{ kid: string; alg: string; signature: string }> {
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  const digestHex = digestBuf.toString('hex');
  const resp = await postJson<{ kid: string; alg: string; signature: string }>('/sign/hash', { digest_hex: digestHex });
  if (!resp || !resp.signature) throw new Error('signing proxy returned no signature');
  return resp;
}

/** Verify a signature against a digest buffer using the proxy */
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

