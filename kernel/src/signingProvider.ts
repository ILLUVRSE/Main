import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
import fetch, { RequestInit } from 'node-fetch';
import { ManifestSignature } from './types';
import { KmsConfig, loadKmsConfig } from './config/kms';

export interface SigningRequest {
  manifest: any;
  manifestId: string;
  ts: string;
  payload: string;
  version?: string;
}

export interface DataSigningRequest {
  data: string;
  payload: string;
  ts: string;
}

export interface SigningProvider {
  signManifest(manifest: any, request?: SigningRequest): Promise<ManifestSignature>;
  signData?(data: string, request?: DataSigningRequest): Promise<{ signature: string; signerId: string }>;
  getPublicKey(signerId?: string): Promise<string | null>;
}

export function canonicalizePayload(obj: any): string {
  const normalize = (value: any): any => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(normalize);
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalize(value[key]);
    }
    return out;
  };
  return JSON.stringify(normalize(obj));
}

export function prepareManifestSigningRequest(manifest: any): SigningRequest {
  const ts = new Date().toISOString();
  const manifestId = manifest?.id ?? `manifest-${crypto.randomUUID()}`;
  const version = manifest?.version ?? '1.0.0';
  const payload = canonicalizePayload({ manifest, ts });
  return { manifest, manifestId, ts, payload, version };
}

export function prepareDataSigningRequest(data: string): DataSigningRequest {
  const ts = new Date().toISOString();
  const payload = canonicalizePayload({ data, ts });
  return { data, payload, ts };
}

type KeyPair = { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
const localKeyCache: Map<string, KeyPair> = new Map();

function getOrCreateKeyPair(signerId: string): KeyPair {
  if (!localKeyCache.has(signerId)) {
    localKeyCache.set(signerId, crypto.generateKeyPairSync('ed25519'));
  }
  return localKeyCache.get(signerId)!;
}

export class LocalSigningProvider implements SigningProvider {
  constructor(private signerId: string = 'kernel-signer-local') {}

  async signManifest(manifest: any, request?: SigningRequest): Promise<ManifestSignature> {
    const prepared = request ?? prepareManifestSigningRequest(manifest);
    const { privateKey } = getOrCreateKeyPair(this.signerId);
    const signature = crypto.sign(null as any, Buffer.from(prepared.payload), privateKey).toString('base64');
    return {
      id: `sig-${crypto.randomUUID()}`,
      manifestId: prepared.manifestId,
      signerId: this.signerId,
      signature,
      version: prepared.version,
      ts: prepared.ts,
      prevHash: null,
    };
  }

  async signData(data: string, request?: DataSigningRequest): Promise<{ signature: string; signerId: string }> {
    const prepared = request ?? prepareDataSigningRequest(data);
    const { privateKey } = getOrCreateKeyPair(this.signerId);
    const signature = crypto.sign(null as any, Buffer.from(prepared.payload), privateKey).toString('base64');
    return { signature, signerId: this.signerId };
  }

  async getPublicKey(_signerId?: string): Promise<string> {
    const { publicKey } = getOrCreateKeyPair(this.signerId);
    const exported = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    return exported.toString('base64');
  }
}

function mapKmsManifestResponse(body: any, manifestId: string, fallbackSignerId: string, ts: string): ManifestSignature {
  const mappedId = body.id ?? body.signature_id ?? crypto.randomUUID();
  const signerId = body.signer_id ?? body.signerId ?? fallbackSignerId;
  const responseManifestId = body.manifest_id ?? body.manifestId ?? manifestId;
  return {
    id: String(mappedId),
    manifestId: responseManifestId,
    signerId,
    signature: body.signature ?? body.sig ?? '',
    version: body.version ?? body.key_version ?? undefined,
    ts: body.ts ?? ts,
    prevHash: body.prev_hash ?? body.prevHash ?? null,
  };
}

class HttpKmsSigningProvider implements SigningProvider {
  private agent?: https.Agent;

  constructor(private config: KmsConfig) {
    this.agent = this.createHttpsAgentIfNeeded();
  }

  private createHttpsAgentIfNeeded(): https.Agent | undefined {
    if (this.config.mtlsCertPath && this.config.mtlsKeyPath) {
      try {
        const cert = fs.readFileSync(this.config.mtlsCertPath);
        const key = fs.readFileSync(this.config.mtlsKeyPath);
        return new https.Agent({ cert, key, keepAlive: true });
      } catch (err) {
        console.warn('HttpKmsSigningProvider: unable to read mTLS credentials', err);
      }
    }
    return undefined;
  }

  private buildHeaders(includeContentType = true): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeContentType) headers['Content-Type'] = 'application/json';
    if (this.config.bearerToken) headers['Authorization'] = `Bearer ${this.config.bearerToken}`;
    return headers;
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    if (!this.config.endpoint) throw new Error('KMS endpoint not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.endpoint}${path}`, {
        ...init,
        agent: this.agent,
        signal: controller.signal as any,
      });
      if (!response.ok) {
        const txt = await response.text().catch(() => '<no body>');
        throw new Error(`KMS error ${response.status}: ${txt}`);
      }
      if (response.headers.get('content-type')?.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async signManifest(manifest: any, request?: SigningRequest): Promise<ManifestSignature> {
    const prepared = request ?? prepareManifestSigningRequest(manifest);
    const body = {
      signerId: this.config.signerId,
      payload: prepared.payload,
      manifestId: prepared.manifestId,
    };
    const response = await this.request('/sign', {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify(body),
    });
    return mapKmsManifestResponse(response, prepared.manifestId, this.config.signerId, prepared.ts);
  }

  async signData(data: string, request?: DataSigningRequest): Promise<{ signature: string; signerId: string }> {
    const prepared = request ?? prepareDataSigningRequest(data);
    const body = {
      signerId: this.config.signerId,
      data: prepared.payload,
    };
    const response = await this.request('/signData', {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify(body),
    });
    return {
      signature: response.signature,
      signerId: response.signerId ?? response.signer_id ?? this.config.signerId,
    };
  }

  async getPublicKey(signerId = this.config.signerId): Promise<string | null> {
    try {
      const result = await this.request(`/publicKeys/${encodeURIComponent(signerId)}`, {
        method: 'GET',
        headers: this.buildHeaders(false),
      });
      if (typeof result === 'string') return result;
      return result?.publicKey ?? result?.public_key ?? null;
    } catch (err) {
      throw new Error(`KMS getPublicKey failed: ${(err as Error).message || err}`);
    }
  }
}

export class FakeKmsSigningProvider implements SigningProvider {
  constructor(
    private readonly options: {
      signerId?: string;
      signature?: string;
      publicKey?: string;
      manifestId?: string;
      ts?: string;
      version?: string;
    } = {},
  ) {}

  async signManifest(manifest: any, request?: SigningRequest): Promise<ManifestSignature> {
    const prepared = request ?? prepareManifestSigningRequest(manifest);
    return {
      id: prepared.manifestId ? `fake-${prepared.manifestId}` : `sig-${crypto.randomUUID()}`,
      manifestId: this.options.manifestId ?? prepared.manifestId,
      signerId: this.options.signerId ?? 'fake-kms-signer',
      signature: this.options.signature ?? Buffer.from('fake-signature').toString('base64'),
      version: this.options.version ?? prepared.version,
      ts: this.options.ts ?? prepared.ts,
      prevHash: null,
    };
  }

  async signData(data: string, request?: DataSigningRequest): Promise<{ signature: string; signerId: string }> {
    const prepared = request ?? prepareDataSigningRequest(data);
    return {
      signature: this.options.signature ?? Buffer.from(`fake:${prepared.payload}`).toString('base64'),
      signerId: this.options.signerId ?? 'fake-kms-signer',
    };
  }

  async getPublicKey(_signerId?: string): Promise<string> {
    return this.options.publicKey ?? Buffer.from('fake-public-key').toString('base64');
  }
}

export function createSigningProvider(
  config: KmsConfig = loadKmsConfig(),
  type: 'auto' | 'local' | 'kms' = 'auto',
): SigningProvider {
  if (type === 'local' || (type === 'auto' && !config.endpoint)) {
    return new LocalSigningProvider(config.signerId);
  }
  return new HttpKmsSigningProvider(config);
}

export { HttpKmsSigningProvider };
