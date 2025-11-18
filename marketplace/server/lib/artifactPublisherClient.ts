/**
 * marketplace/server/lib/artifactPublisherClient.ts
 *
 * Simple client for the Artifact Publisher service.
 *
 * Responsibilities:
 *  - publishDelivery(payload) -> calls ArtifactPublisher to store an encrypted
 *    delivery artifact and create a signed proof object (or returns a synthesized
 *    delivery/proof in dev when ARTIFACT_PUBLISHER_URL is not set).
 *  - health() -> lightweight health check for CI/runbooks.
 *
 * Env:
 *  - ARTIFACT_PUBLISHER_URL    e.g. https://artifact-publisher.internal.example
 *  - ARTIFACT_PUBLISHER_TOKEN  optional Bearer token for auth
 *
 * Expected artifact-publisher API shape (example):
 *  - POST /deliveries
 *    body: {
 *      orderId, skuId, buyerId,
 *      ledgerProof,
 *      license,
 *      artifact_sha256?,
 *      storage_hint?: { type:'s3' | 's3-pre-signed', url?: 's3://...' }
 *    }
 *    returns: { ok:true, delivery: { delivery_id, status, encrypted_delivery_url, proof_id, proof: {...} } }
 *
 * This client is intentionally small and uses node-fetch for HTTP requests. When
 * no ARTIFACT_PUBLISHER_URL is present, it synthesizes a delivery/proof for dev.
 */

import fetch from 'node-fetch';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Buffer } from 'buffer';

export type PublishDeliveryPayload = {
  orderId: string;
  skuId: string;
  buyerId: string;
  ledgerProof?: any;
  license?: any;
  artifactSha256?: string;
  manifestSignatureId?: string;
  metadata?: any;
};

export type DeliveryResult = {
  delivery: {
    delivery_id: string;
    status: string; // 'ready' | 'initiated' | 'failed'
    encrypted_delivery_url?: string;
    proof_id?: string;
    proof?: any;
  };
};

function readOptionalFile(p?: string) {
  if (!p) return undefined;
  try {
    const full = path.resolve(p);
    if (fs.existsSync(full)) return fs.readFileSync(full);
    return undefined;
  } catch {
    return undefined;
  }
}

export class ArtifactPublisherClient {
  private baseUrl?: string;
  private apiToken?: string;
  private agent?: https.Agent;

  constructor() {
    this.baseUrl = process.env.ARTIFACT_PUBLISHER_URL;
    this.apiToken = process.env.ARTIFACT_PUBLISHER_TOKEN;

    // optional mTLS
    const certPath = process.env.ARTIFACT_PUBLISHER_MTLS_CERT_PATH;
    const keyPath = process.env.ARTIFACT_PUBLISHER_MTLS_KEY_PATH;
    const caPath = process.env.ARTIFACT_PUBLISHER_MTLS_CA_PATH;

    const certRaw = readOptionalFile(certPath);
    const keyRaw = readOptionalFile(keyPath);
    const caRaw = readOptionalFile(caPath);

    if (certRaw && keyRaw) {
      this.agent = new https.Agent({
        cert: certRaw,
        key: keyRaw,
        ca: caRaw || undefined,
        keepAlive: true,
        rejectUnauthorized: caRaw ? true : false,
      });
    } else {
      this.agent = new https.Agent({ keepAlive: true });
    }
  }

  isConfigured() {
    return !!this.baseUrl;
  }

  private _url(p: string) {
    if (!this.baseUrl) throw new Error('ARTIFACT_PUBLISHER_URL not configured');
    return `${this.baseUrl.replace(/\/$/, '')}${p}`;
  }

  private _headers(extra?: Record<string, string>) {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (this.apiToken) h['Authorization'] = `Bearer ${this.apiToken}`;
    return h;
  }

  private async _fetchJson<T = any>(url: string, opts: any = {}): Promise<T> {
    const merged = {
      ...opts,
      agent: this.agent,
    };
    const res = await fetch(url, merged);
    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>');
      throw new Error(`ArtifactPublisher ${res.status} ${res.statusText}: ${body}`);
    }
    return (await res.json()) as T;
  }

  /**
   * publishDelivery
   * - In production calls ArtifactPublisher /deliveries
   * - In dev (no ARTIFACT_PUBLISHER_URL) synthesizes a delivery + proof object
   */
  async publishDelivery(payload: PublishDeliveryPayload): Promise<DeliveryResult> {
    if (!this.baseUrl) {
      // synthesize: create proof id + delivery url (s3 pseudo) and small proof
      const proofId = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const deliveryId = `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const artifactSha = payload.artifactSha256 || crypto.createHash('sha256').update(payload.orderId + payload.skuId).digest('hex');
      const proof = {
        proof_id: proofId,
        order_id: payload.orderId,
        artifact_sha256: artifactSha,
        ledger_proof_id: payload.ledgerProof?.ledger_proof_id || null,
        signer_kid: process.env.ARTIFACT_PUBLISHER_SIGNER_KID || 'artifact-publisher-signer-v1',
        signature: Buffer.from(`proof:${proofId}`).toString('base64'),
        ts: new Date().toISOString(),
        canonical_payload: {
          orderId: payload.orderId,
          skuId: payload.skuId,
          artifact_sha256: artifactSha,
        },
      };

      const delivery = {
        delivery_id: deliveryId,
        status: 'ready',
        encrypted_delivery_url: `s3://local/mock/${proofId}`,
        proof_id: proofId,
        proof,
      };

      return { delivery };
    }

    const url = this._url('/deliveries');
    const body = {
      order_id: payload.orderId,
      sku_id: payload.skuId,
      buyer_id: payload.buyerId,
      ledger_proof: payload.ledgerProof,
      license: payload.license,
      artifact_sha256: payload.artifactSha256,
      manifest_signature_id: payload.manifestSignatureId,
      metadata: payload.metadata || {},
    };

    const resp = await this._fetchJson<{ ok: true; delivery: any }>(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!resp || !resp.delivery) {
      throw new Error('ArtifactPublisher returned unexpected response');
    }

    return { delivery: resp.delivery };
  }

  /**
   * health - try common endpoints for a quick health check
   */
  async health(): Promise<boolean> {
    if (!this.baseUrl) return false;
    const endpoints = ['/health', '/ping', '/status', '/'];
    for (const p of endpoints) {
      try {
        const res = await fetch(this._url(p), { method: 'GET', headers: this._headers(), agent: this.agent });
        if (res.ok) return true;
      } catch {
        // try next
      }
    }
    return false;
  }
}

/* Singleton */
export const artifactPublisherClient = new ArtifactPublisherClient();
export default artifactPublisherClient;

