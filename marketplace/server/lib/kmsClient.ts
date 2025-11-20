/**
 * marketplace/server/lib/kmsClient.ts
 *
 * Lightweight, pluggable signing client that supports:
 *  - AWS KMS (recommended for production)
 *  - HTTP signing proxy (useful for signing-proxy + HSM frontends)
 *
 * Behavior:
 *  - Chooses provider based on environment:
 *      * If SIGNING_PROXY_URL is set => uses signing-proxy mode
 *      * Otherwise attempts to use AWS KMS when AWS_KMS_KEY_ID is present
 *  - Exposes `sign(buffer)` and `getPublicKey(kid?)`
 *
 * Env:
 *  - SIGNING_PROXY_URL = https://signer.example.local (optional)
 *  - SIGNING_PROXY_API_KEY = api-key-for-proxy (optional, forwarded as Authorization)
 *  - AWS_KMS_KEY_ID = arn:aws:kms:... or alias/..., required to use KMS mode
 *  - SIGNING_ALGORITHM = RSASSA_PKCS1_V1_5_SHA_256 (default) or RSASSA_PSS_SHA_256 etc.
 *
 * Notes:
 *  - This file uses dynamic imports of aws-sdk so it doesn't fail when the SDK
 *    isn't installed for environments that only use signing-proxy.
 *  - The sign() method returns a base64 signature and a signer_kid string that
 *    can be used by other services as an identifier for the signer key.
 */

import crypto from 'crypto';
import fetch from 'node-fetch'; // Ensure node-fetch is in dependencies in server package.json
import { Buffer } from 'buffer';

export type SignResult = {
  signature: string; // base64
  signer_kid?: string;
  ts?: string;
};

export class KmsClient {
  private mode: 'kms' | 'proxy' | 'disabled';
  private proxyUrl?: string;
  private proxyApiKey?: string;
  private kmsKeyId?: string;
  private signingAlgorithm: string;

  constructor() {
    // prefer explicit proxy when provided
    this.proxyUrl = process.env.SIGNING_PROXY_URL;
    this.proxyApiKey = process.env.SIGNING_PROXY_API_KEY;
    this.kmsKeyId = process.env.AWS_KMS_KEY_ID;
    this.signingAlgorithm = process.env.SIGNING_ALGORITHM || 'RSASSA_PKCS1_V1_5_SHA_256';

    if (this.proxyUrl) {
      this.mode = 'proxy';
    } else if (this.kmsKeyId) {
      this.mode = 'kms';
    } else {
      this.mode = 'disabled';
      // server should still be able to operate in dev with synthesized signatures,
      // but production must not use 'disabled'.
    }
  }

  isConfigured(): boolean {
    return this.mode !== 'disabled';
  }

  getMode(): 'kms' | 'proxy' | 'disabled' {
    return this.mode;
  }

  /**
   * Sign a raw message buffer and return base64 signature + signer id.
   * If using KMS, MessageType='RAW' is used (KMS will hash if needed depending
   * on algorithm). For KMS RSA PKCS1 v1.5 + sha256 we can pass RAW and KMS
   * will perform the hash when using the proper SigningAlgorithm.
   *
   * @param data Buffer of bytes to sign
   * @param options optional override such as keyId or algorithm
   */
  async sign(
    data: Buffer,
    options?: { keyId?: string; algorithm?: string }
  ): Promise<SignResult> {
    const alg = options?.algorithm || this.signingAlgorithm;
    const keyId = options?.keyId || this.kmsKeyId;

    if (this.mode === 'kms') {
      if (!keyId) throw new Error('AWS_KMS_KEY_ID not configured for KMS signing');
      return this.signWithKms(data, keyId, alg);
    } else if (this.mode === 'proxy') {
      return this.signWithProxy(data, alg, options?.keyId);
    } else {
      // disabled: synthesize a signature (only for dev/testing)
      return this.synthesizeSignature(data);
    }
  }

  /**
   * Fetch public key in PEM form for a given kid (if supported).
   * For KMS it will call GetPublicKey; for proxy it will call /public-key?kid=...
   */
  async getPublicKey(kid?: string): Promise<{ publicKeyPem?: string; signer_kid?: string } | null> {
    if (this.mode === 'kms') {
      if (!this.kmsKeyId) throw new Error('AWS_KMS_KEY_ID not configured');
      return this.getKmsPublicKey(kid || this.kmsKeyId);
    } else if (this.mode === 'proxy') {
      return this.getProxyPublicKey(kid);
    } else {
      return null;
    }
  }

  /* ---------------------------
   * KMS implementation (AWS KMS)
   * --------------------------- */

  private async signWithKms(data: Buffer, keyId: string, algorithm: string): Promise<SignResult> {
    // dynamic import so library is optional
    const { KMSClient, SignCommand } = await import('@aws-sdk/client-kms');

    const client = new KMSClient({});

    // KMS Sign expects a Uint8Array
    const message = new Uint8Array(data);

    const cmd = new SignCommand({
      KeyId: keyId,
      Message: message,
      MessageType: 'RAW', // RAW means we give the raw bytes; KMS expects to hash or sign according to algorithm
      SigningAlgorithm: algorithm as any,
    });

    const resp = await client.send(cmd);
    const sig = resp.Signature;
    if (!sig) throw new Error('KMS did not return a signature');

    const signatureB64 = Buffer.from(sig).toString('base64');
    const signer_kid = keyId; // we use keyId/ARN as signer identifier
    return { signature: signatureB64, signer_kid, ts: new Date().toISOString() };
  }

  private async getKmsPublicKey(keyId: string) {
    const { KMSClient, GetPublicKeyCommand } = await import('@aws-sdk/client-kms');
    const client = new KMSClient({});
    const cmd = new GetPublicKeyCommand({ KeyId: keyId });
    const resp = await client.send(cmd);
    const pub = resp.PublicKey;
    if (!pub) return null;
    const pem = this._convertDerToPem(pub);
    return { publicKeyPem: pem, signer_kid: keyId };
  }

  /* ---------------------------
   * Signing proxy implementation
   * --------------------------- */

  private async signWithProxy(data: Buffer, algorithm: string, kid?: string): Promise<SignResult> {
    if (!this.proxyUrl) throw new Error('SIGNING_PROXY_URL not configured');

    const payload = {
      data: data.toString('base64'),
      algorithm,
      kid,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.proxyApiKey) headers['Authorization'] = `Bearer ${this.proxyApiKey}`;

    const res = await fetch(`${this.proxyUrl.replace(/\/$/, '')}/sign`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Signing proxy error ${res.status}: ${txt}`);
    }

    const json: { signature?: string; signer_kid?: string; ts?: string } = await res
      .json()
      .catch(() => ({}));
    if (!json.signature) {
      throw new Error('Signing proxy returned invalid response');
    }

    return {
      signature: String(json.signature),
      signer_kid: json.signer_kid || kid,
      ts: json.ts,
    };
  }

  private async getProxyPublicKey(kid?: string) {
    if (!this.proxyUrl) throw new Error('SIGNING_PROXY_URL not configured');
    const url = `${this.proxyUrl.replace(/\/$/, '')}/public-key${kid ? `?kid=${encodeURIComponent(kid)}` : ''}`;
    const headers: Record<string, string> = {};
    if (this.proxyApiKey) headers['Authorization'] = `Bearer ${this.proxyApiKey}`;

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Signing proxy public key error ${res.status}: ${txt}`);
    }
    const json: { publicKeyPem?: string; signer_kid?: string } = await res
      .json()
      .catch(() => ({}));
    return {
      publicKeyPem: json.publicKeyPem,
      signer_kid: json.signer_kid || kid,
    };
  }

  /* ---------------------------
   * Helpers
   * --------------------------- */

  private synthesizeSignature(data: Buffer): SignResult {
    // Synthesize a signature deterministically for dev/test:
    const h = crypto.createHash('sha256').update(data).digest();
    const sig = Buffer.from(h).toString('base64');
    return { signature: sig, signer_kid: 'synth-signer-dev', ts: new Date().toISOString() };
  }

  private _convertDerToPem(derBufLike: Uint8Array | undefined) {
    if (!derBufLike) return undefined;
    const der = Buffer.from(derBufLike);
    const b64 = der.toString('base64');
    const lines = b64.match(/.{1,64}/g) || [];
    const pem = ['-----BEGIN PUBLIC KEY-----', ...lines, '-----END PUBLIC KEY-----'].join('\n');
    return pem + '\n';
  }
}

/* Singleton convenience export */
export const kmsClient = new KmsClient();
export default kmsClient;
