/**
 * marketplace/server/lib/manifestValidator.ts
 *
 * validateManifest(manifest) => Promise<{ valid: boolean, manifestSignatureId?: string, details?: any }>
 *
 * Behavior:
 *  - If KERNEL_API_URL is configured, call the Kernel validate endpoint:
 *      - Prefer server token (KERNEL_CONTROL_PANEL_TOKEN) if present.
 *      - If KERNEL_CLIENT_CERT and KERNEL_CLIENT_KEY are present, attempt mTLS using https.Agent.
 *  - If Kernel call fails or is not configured, perform local best-effort validation:
 *      - Ensure manifest has expected fields and a manifest_signature object with signature + signer_kid.
 *      - In dev return valid:true and a synthesized manifestSignatureId.
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

type ValidationResult = {
  valid: boolean;
  manifestSignatureId?: string;
  details?: any;
};

function readPemMaybe(value?: string): string | undefined {
  if (!value) return undefined;
  // If value looks like a file path and file exists, read it
  try {
    if (fs.existsSync(value)) {
      return fs.readFileSync(value, 'utf8');
    }
  } catch {
    // ignore, treat as inline PEM
  }
  return value;
}

/**
 * POST JSON helper that optionally supports HTTPS agent (mTLS).
 */
async function postJson(urlStr: string, body: any, opts: { agent?: any; headers?: Record<string, string> } = {}): Promise<any> {
  const url = new URL(urlStr);
  const payload = JSON.stringify(body);
  const isHttps = url.protocol === 'https:';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
    ...(opts.headers || {}),
  };

  const requestOptions: any = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname || '/'}${url.search || ''}`,
    headers,
    timeout: 15_000,
  };

  if (opts.agent) {
    requestOptions.agent = opts.agent;
  }

  return new Promise((resolve, reject) => {
    const req = (isHttps ? https.request : http.request)(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => {
        const s = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = s ? JSON.parse(s) : null;
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            // include body for diagnostics
            reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage || ''} - ${s}`));
          }
        } catch (e) {
          // Non-JSON reply
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(s);
          } else {
            reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage || ''} - ${s}`));
          }
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Validate manifest by calling Kernel (if configured), otherwise local best-effort.
 */
export async function validateManifest(manifest: any): Promise<ValidationResult> {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, details: { message: 'manifest must be an object' } };
  }

  const kernelUrl = process.env.KERNEL_API_URL;
  if (kernelUrl) {
    // Build headers
    const headers: Record<string, string> = {};

    // Prefer control panel token if provided
    const controlToken = process.env.KERNEL_CONTROL_PANEL_TOKEN;
    if (controlToken) {
      headers['Authorization'] = `Bearer ${controlToken}`;
    }

    // Consider mTLS: KERNEL_CLIENT_CERT / KERNEL_CLIENT_KEY may be either file paths or inline PEM
    const clientCertRaw = readPemMaybe(process.env.KERNEL_CLIENT_CERT || '');
    const clientKeyRaw = readPemMaybe(process.env.KERNEL_CLIENT_KEY || '');
    const caRaw = readPemMaybe(process.env.KERNEL_CLIENT_CA || '') || undefined;

    try {
      let agent;
      if (clientCertRaw && clientKeyRaw) {
        // Create https agent for mTLS
        agent = new https.Agent({
          cert: clientCertRaw,
          key: clientKeyRaw,
          ca: caRaw,
          keepAlive: false,
          rejectUnauthorized: process.env.KERNEL_SKIP_TLS_VERIFY === 'true' ? false : true,
        });
      }

      // Try canonical Kernel manifest validate endpoints (fallback order)
      const endpoints = [
        `${kernelUrl.replace(/\/$/, '')}/admin/validate-manifest`,
        `${kernelUrl.replace(/\/$/, '')}/manifests/validate`,
        `${kernelUrl.replace(/\/$/, '')}/validate-manifest`,
      ];

      let lastErr: any = null;
      for (const ep of endpoints) {
        try {
          const resp = await postJson(ep, { manifest }, { agent, headers });
          // Expect kernel to return { ok: true, valid: true/false, manifestSignatureId?: string, details? }
          if (resp && (resp.ok === true || typeof resp.valid !== 'undefined')) {
            // Normalize result
            return {
              valid: Boolean(resp.valid ?? resp.ok),
              manifestSignatureId: resp.manifestSignatureId || resp.manifest_signature_id || (manifest.manifest_signature && manifest.manifest_signature.id) || undefined,
              details: resp.details || resp,
            };
          }
          // If response didn't match expectation, continue trying other endpoints
          lastErr = new Error(`Unexpected kernel response at ${ep}: ${JSON.stringify(resp)}`);
        } catch (err) {
          lastErr = err;
          // try next endpoint
        }
      }

      // If we reached here, kernel call(s) failed
      return { valid: false, details: { message: 'Kernel validation failed', error: String(lastErr) } };
    } catch (err) {
      // Failover to local validation below
      // eslint-disable-next-line no-console
      console.debug('Kernel call failed for manifest validation:', (err as Error).message);
    }
  }

  // Local best-effort validation
  try {
    const required = ['id', 'title', 'version', 'checksum', 'author', 'artifacts', 'manifest_signature'];
    const missing = required.filter((k) => !(k in manifest));
    if (missing.length > 0) {
      return { valid: false, details: { missing } };
    }

    const sig = manifest.manifest_signature || manifest.manifestSignature || {};
    if (!sig || !sig.signature || !sig.signer_kid) {
      return { valid: false, details: { message: 'manifest_signature is missing signer_kid or signature' } };
    }

    // Optionally check checksum of artifacts if small (best-effort)
    // NOTE: Full checksum validation requires fetching artifacts (expensive). We skip here.

    // Synthesize an id (non-production)
    const manifestSignatureId =
      sig.signature && typeof sig.signature === 'string' ? `manifest-sig-${cryptoLikeShortHash(sig.signature)}` : `manifest-sig-dev-${uuidv4()}`;

    return {
      valid: true,
      manifestSignatureId,
      details: { note: 'Best-effort local validation passed (use Kernel in production)' },
    };
  } catch (err: any) {
    return { valid: false, details: { message: 'Local validation failed', error: String(err) } };
  }
}

/**
 * Small deterministic short-hash helper for dev manifestSignatureId generation.
 */
function cryptoLikeShortHash(input: string): string {
  try {
    // Use built-in crypto if available
    // Avoid importing top-level crypto for older node compatibility here; use a simple hash.
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 16);
  } catch {
    // Fallback naive hashing
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0).toString(16);
  }
}

export default {
  validateManifest,
};

