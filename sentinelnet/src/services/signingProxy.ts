import axios, { AxiosError, AxiosInstance } from 'axios';
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';
import logger from '../logger';

const LOCAL_SIGNER_PREFIX = 'local-ed25519:';
const DEFAULT_TIMEOUT_MS = 3000;

type KmsSignResponse = { signature_b64?: string; signer_id?: string };
type KmsVerifyResponse = { verified?: boolean };

type LocalKeyPair = {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  publicBytes: Buffer;
};

export class SigningProxy {
  private readonly endpoint: string | undefined;
  private readonly keyB64?: string;
  private readonly client: AxiosInstance;
  private localKey?: LocalKeyPair;

  constructor() {
    this.endpoint = (process.env.SENTINEL_KMS_ENDPOINT || '').replace(/\/+$/, '') || undefined;
    this.keyB64 = process.env.SENTINEL_SIGNER_KEY_B64;

    const timeoutMs =
      parseInt(process.env.KMS_TIMEOUT_MS || '', 10) > 0
        ? parseInt(process.env.KMS_TIMEOUT_MS || '', 10)
        : DEFAULT_TIMEOUT_MS;

    const httpsAgent = buildMtlsAgent();
    this.client = axios.create({
      baseURL: this.endpoint,
      timeout: timeoutMs,
      httpsAgent,
      validateStatus: (status) => status >= 200 && status < 300,
    });
  }

  async sign(payload: Buffer): Promise<{ signatureB64: string; signerId: string }> {
    if (!payload || payload.length === 0) {
      throw new Error('payload is required for signing');
    }

    if (this.endpoint) {
      try {
        return await this.signWithKms(payload);
      } catch (err) {
        logger.warn('KMS signing failed, attempting fallback', { error: (err as Error).message });
      }
    }

    return this.signLocal(payload);
  }

  async verify(payload: Buffer, signatureB64: string, signerId: string): Promise<void> {
    if (signerId.startsWith(LOCAL_SIGNER_PREFIX)) {
      return this.verifyLocal(payload, signatureB64);
    }
    if (!this.endpoint) {
      throw new Error('KMS endpoint not configured; cannot verify remote signature');
    }
    return this.verifyWithKms(payload, signatureB64, signerId);
  }

  private async signWithKms(payload: Buffer): Promise<{ signatureB64: string; signerId: string }> {
    const body = { payload_b64: payload.toString('base64') };
    const resp = await this.postWithRetry('/sign', body);
    const data = (resp?.data || {}) as KmsSignResponse;
    if (!data.signature_b64 || !data.signer_id) {
      throw new Error('kms response missing signature_b64 or signer_id');
    }
    return { signatureB64: data.signature_b64, signerId: data.signer_id };
  }

  private async verifyWithKms(
    payload: Buffer,
    signatureB64: string,
    signerId: string,
  ): Promise<void> {
    const body = {
      payload_b64: payload.toString('base64'),
      signature_b64: signatureB64,
      signer_id: signerId,
    };
    const resp = await this.postWithRetry('/verify', body);
    const data = (resp?.data || {}) as KmsVerifyResponse;
    if (!data.verified) {
      throw new Error('kms verification failed');
    }
  }

  private async signLocal(payload: Buffer): Promise<{ signatureB64: string; signerId: string }> {
    const key = this.ensureLocalKey();
    const signature = crypto.sign(null, payload, key.privateKey);
    const signerId = `${LOCAL_SIGNER_PREFIX}${shortSha(key.publicBytes)}`;
    return { signatureB64: signature.toString('base64'), signerId };
  }

  private async verifyLocal(payload: Buffer, signatureB64: string): Promise<void> {
    const key = this.ensureLocalKey();
    const sig = Buffer.from(signatureB64, 'base64');
    const ok = crypto.verify(null, payload, key.publicKey, sig);
    if (!ok) {
      throw new Error('local signature verification failed');
    }
  }

  private async postWithRetry(path: string, body: any) {
    let lastErr: any;
    let delay = 100;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
      try {
        return await this.client.post(path, body);
      } catch (err) {
        lastErr = err;
        if (!this.shouldRetry(err) || attempt === 1) {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  private shouldRetry(err: any): boolean {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status || 0;
    if (status >= 500) return true;
    const code = (axiosErr as any)?.code;
    const retryable = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'];
    if (code && retryable.includes(code)) return true;
    if (axiosErr.response == null && axiosErr.request) return true;
    return false;
  }

  private ensureLocalKey(): LocalKeyPair {
    if (this.localKey) {
      return this.localKey;
    }
    if (!this.keyB64) {
      throw new Error('fallback key not configured (SENTINEL_SIGNER_KEY_B64)');
    }
    const raw = Buffer.from(this.keyB64.trim(), 'base64');
    if (![32, 64].includes(raw.length)) {
      throw new Error(`unexpected ed25519 key length ${raw.length}`);
    }
    const seed = raw.slice(0, 32);
    const privateKey = crypto.createPrivateKey({
      key: buildEd25519PKCS8(seed),
      format: 'der',
      type: 'pkcs8',
    });
    let publicBytes: Buffer;
    let publicKey: crypto.KeyObject;
    if (raw.length === 64) {
      publicBytes = raw.slice(32);
      publicKey = crypto.createPublicKey({
        key: buildEd25519SPKI(publicBytes),
        format: 'der',
        type: 'spki',
      });
    } else {
      publicKey = crypto.createPublicKey(privateKey);
      publicBytes = extractPublicKeyBytes(publicKey);
    }
    this.localKey = { privateKey, publicKey, publicBytes };
    return this.localKey;
  }
}

function buildMtlsAgent(): https.Agent | undefined {
  const certEnv = process.env.SENTINEL_CLIENT_CERT;
  const keyEnv = process.env.SENTINEL_CLIENT_KEY;
  const caEnv = process.env.SENTINEL_CA_CERT;

  if (!certEnv || !keyEnv) {
    if (process.env.DEV_SKIP_MTLS === 'true') {
      logger.info('DEV_SKIP_MTLS enabled; not configuring mTLS for KMS client');
    }
    return undefined;
  }

  try {
    const cert = readValueOrFile(certEnv);
    const key = readValueOrFile(keyEnv);
    const ca = caEnv ? readValueOrFile(caEnv) : undefined;
    return new https.Agent({
      cert,
      key,
      ca,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    });
  } catch (err) {
    logger.warn('failed to configure mTLS agent; proceeding without client cert', {
      error: (err as Error).message,
    });
    return undefined;
  }
}

function readValueOrFile(value: string): Buffer {
  if (fs.existsSync(value)) {
    return fs.readFileSync(value);
  }
  if (value.includes('BEGIN')) {
    return Buffer.from(value);
  }
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length > 0) {
      return decoded;
    }
  } catch {
    // ignore and return raw
  }
  return Buffer.from(value);
}

function buildEd25519PKCS8(seed: Buffer): Buffer {
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return Buffer.concat([prefix, seed]);
}

function buildEd25519SPKI(publicKey: Buffer): Buffer {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return Buffer.concat([prefix, publicKey]);
}

function extractPublicKeyBytes(pub: crypto.KeyObject): Buffer {
  const der = pub.export({ format: 'der', type: 'spki' }) as Buffer;
  return der.slice(-32);
}

function shortSha(buf: Buffer): string {
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return hash.slice(0, 8);
}

export default SigningProxy;
