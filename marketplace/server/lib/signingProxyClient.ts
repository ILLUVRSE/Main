/**
 * marketplace/server/lib/signingProxyClient.ts
 *
 * Small HTTP client for talking to a signing-proxy service.
 *
 * Expected proxy endpoints:
 *  - POST /sign  { data: "<base64>", algorithm: "RSASSA_PKCS1_V1_5_SHA_256", kid?: "..." }
 *    -> { signature: "<base64>", signer_kid?: "...", ts?: "ISO" }
 *  - GET  /public-key?kid=... -> { publicKeyPem: "-----BEGIN PUBLIC KEY-----...", signer_kid?: "..." }
 *
 * Configuration via env:
 *  - SIGNING_PROXY_URL       e.g. https://signer.internal.example
 *  - SIGNING_PROXY_API_KEY   optional API key (sent as Bearer in Authorization)
 *
 * This client is intentionally tiny and resilient to proxy transient errors.
 */

import fetch from 'node-fetch';
import { Buffer } from 'buffer';
import { SignResult } from './kmsClient';

export class SigningProxyClient {
  private url?: string;
  private apiKey?: string;

  constructor() {
    this.url = process.env.SIGNING_PROXY_URL;
    this.apiKey = process.env.SIGNING_PROXY_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.url;
  }

  private _url(path: string) {
    if (!this.url) throw new Error('SIGNING_PROXY_URL not configured');
    return `${this.url.replace(/\/$/, '')}${path}`;
  }

  private _headers(extra?: Record<string, string>) {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  /**
   * Sign raw bytes. Returns base64 signature, signer_kid and ts.
   */
  async sign(data: Buffer, algorithm = 'RSASSA_PKCS1_V1_5_SHA_256', kid?: string): Promise<SignResult> {
    if (!this.url) throw new Error('Signing proxy is not configured (SIGNING_PROXY_URL)');

    const payload = {
      data: data.toString('base64'),
      algorithm,
      kid,
    };

    const res = await fetch(this._url('/sign'), {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '<no-body>');
      throw new Error(`Signing proxy responded ${res.status}: ${txt}`);
    }

    const json: { signature?: string; signer_kid?: string; ts?: string } = await res
      .json()
      .catch(() => ({}));
    if (!json.signature) {
      throw new Error('Signing proxy returned invalid response (missing signature)');
    }

    return {
      signature: String(json.signature),
      signer_kid: json.signer_kid || kid,
      ts: json.ts || new Date().toISOString(),
    };
  }

  /**
   * Fetch a public key (PEM) for a signer kid
   */
  async getPublicKey(kid?: string): Promise<{ publicKeyPem?: string; signer_kid?: string } | null> {
    if (!this.url) throw new Error('Signing proxy is not configured (SIGNING_PROXY_URL)');

    const url = kid ? this._url(`/public-key?kid=${encodeURIComponent(kid)}`) : this._url('/public-key');
    const res = await fetch(url, {
      method: 'GET',
      headers: this._headers(),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '<no-body>');
      throw new Error(`Signing proxy public-key returned ${res.status}: ${txt}`);
    }

    const json: { publicKeyPem?: string; signer_kid?: string } = await res
      .json()
      .catch(() => ({}));
    if (!json.publicKeyPem) {
      return null;
    }

    return {
      publicKeyPem: String(json.publicKeyPem),
      signer_kid: json.signer_kid || kid,
    };
  }

  /**
   * Simple health check: GET /health or /ping if available.
   * Returns true when proxy reachable and returns 200.
   */
  async health(): Promise<boolean> {
    if (!this.url) return false;
    const endpoints = ['/health', '/ping', '/'];
    for (const p of endpoints) {
      try {
        const res = await fetch(this._url(p), { method: 'GET', headers: this._headers() });
        if (res.ok) return true;
      } catch {
        // ignore and try next endpoint
      }
    }
    return false;
  }
}

/* singleton convenience export */
export const signingProxyClient = new SigningProxyClient();
export default signingProxyClient;
