/**
 * marketplace/server/lib/financeClient.ts
 *
 * Small Finance integration client that:
 *  - Calls a Finance service over HTTPS (supports optional mTLS)
 *  - Provides `createLedgerForOrder` to create a ledger/journal entry for an order
 *  - Provides `health()` for CI/runbook checks
 *
 * Configuration (env):
 *  - FINANCE_API_URL           e.g. https://finance.internal.example
 *  - FINANCE_API_TOKEN         optional Bearer token for auth
 *  - FINANCE_MTLS_CERT_PATH    path to client cert PEM (optional)
 *  - FINANCE_MTLS_KEY_PATH     path to client key PEM (optional)
 *  - FINANCE_MTLS_CA_PATH      path to CA PEM to validate server cert (optional)
 *
 * For local/dev use, if FINANCE_API_URL is not provided the client will synthesize
 * ledger proofs (non-production).
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import fetch, { RequestInit } from 'node-fetch';

export type CreateLedgerPayload = {
  orderId: string;
  amount: number; // cents
  currency?: string;
  buyerId?: string;
  metadata?: Record<string, any>;
};

export type LedgerProof = {
  ledger_proof_id: string;
  signer_kid?: string;
  signature?: string; // base64
  ts?: string;
  payload?: any;
};

function readOptionalFile(p?: string) {
  if (!p) return undefined;
  try {
    const full = path.resolve(p);
    if (fs.existsSync(full)) {
      return fs.readFileSync(full);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export class FinanceClient {
  private baseUrl?: string;
  private apiToken?: string;
  private agent?: https.Agent;

  constructor() {
    this.baseUrl = process.env.FINANCE_API_URL;
    this.apiToken = process.env.FINANCE_API_TOKEN;

    // Try mTLS configuration (prefer file paths)
    const certPath = process.env.FINANCE_MTLS_CERT_PATH;
    const keyPath = process.env.FINANCE_MTLS_KEY_PATH;
    const caPath = process.env.FINANCE_MTLS_CA_PATH;

    const certRaw = readOptionalFile(certPath);
    const keyRaw = readOptionalFile(keyPath);
    const caRaw = readOptionalFile(caPath);

    if (certRaw && keyRaw) {
      // Build agent with client cert/key and optional ca
      this.agent = new https.Agent({
        cert: certRaw,
        key: keyRaw,
        ca: caRaw || undefined,
        keepAlive: true,
        rejectUnauthorized: caRaw ? true : false,
      });
    } else {
      // no mTLS - agent not required (but create a default agent with keepAlive)
      this.agent = new https.Agent({ keepAlive: true });
    }
  }

  isConfigured() {
    return !!this.baseUrl;
  }

  private _url(p: string) {
    if (!this.baseUrl) throw new Error('FINANCE_API_URL not configured');
    return `${this.baseUrl.replace(/\/$/, '')}${p}`;
  }

  private _headers(extra?: Record<string, string>) {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (this.apiToken) {
      h['Authorization'] = `Bearer ${this.apiToken}`;
    }
    return h;
  }

  private async _fetchJson<T = any>(url: string, opts: RequestInit = {}): Promise<T> {
    const merged: RequestInit = {
      ...opts,
      agent: this.agent,
      headers: { ...(opts.headers as any || {}) },
    };
    const res = await fetch(url, merged);
    if (!res.ok) {
      const txt = await res.text().catch(() => '<no body>');
      throw new Error(`Finance API ${res.status} ${res.statusText}: ${txt}`);
    }
    return (await res.json()) as T;
  }

  /**
   * createLedgerForOrder
   * - Calls Finance service to create a ledger proof for an order.
   * - Returns a LedgerProof object.
   *
   * If FINANCE_API_URL is not configured, returns a synthesized ledger proof
   * suitable for local development/testing.
   */
  async createLedgerForOrder(payload: CreateLedgerPayload): Promise<LedgerProof> {
    if (!this.baseUrl) {
      // synthesize a ledger proof for dev/test
      const ledgerProofId = `ledger-sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const signature = Buffer.from(`ledger:${ledgerProofId}`).toString('base64');
      return {
        ledger_proof_id: ledgerProofId,
        signer_kid: process.env.FINANCE_SIGNER_KID || 'finance-signer-v1',
        signature,
        ts: new Date().toISOString(),
        payload: {
          simulated: true,
          orderId: payload.orderId,
          amount: payload.amount,
        },
      };
    }

    const url = this._url('/ledgers');
    const body = {
      order_id: payload.orderId,
      amount: payload.amount,
      currency: payload.currency || 'USD',
      buyer_id: payload.buyerId,
      metadata: payload.metadata || {},
    };

    const resp = await this._fetchJson<{ ledger_proof: any }>(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    // Expect finance to reply with ledger_proof object (ledger_proof_id, signature, signer_kid)
    if (!resp || !resp.ledger_proof) {
      throw new Error('Finance create ledger returned unexpected response');
    }

    // Normalize to LedgerProof shape
    const lp = resp.ledger_proof;
    return {
      ledger_proof_id: lp.ledger_proof_id || lp.id,
      signer_kid: lp.signer_kid,
      signature: lp.signature,
      ts: lp.ts || new Date().toISOString(),
      payload: lp.payload || lp,
    };
  }

  supportsSettlement(): boolean {
    return !!this.baseUrl;
  }

  async settleOrder(payload: CreateLedgerPayload & { deliveryMode?: string }): Promise<LedgerProof> {
    if (!this.baseUrl) {
      return this.createLedgerForOrder(payload);
    }

    const url = this._url('/settlement');
    const body = {
      order_id: payload.orderId,
      amount: payload.amount,
      currency: payload.currency || 'USD',
      buyer_id: payload.buyerId,
      delivery_mode: payload.deliveryMode,
      metadata: payload.metadata || {},
    };

    const resp = await this._fetchJson<{ ledger_proof: any }>(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!resp || !resp.ledger_proof) {
      throw new Error('Finance settlement returned unexpected response');
    }
    const lp = resp.ledger_proof;
    return {
      ledger_proof_id: lp.ledger_proof_id || lp.id,
      signer_kid: lp.signer_kid,
      signature: lp.signature,
      ts: lp.ts || new Date().toISOString(),
      payload: lp.payload || lp,
    };
  }

  async verifyLedgerProof(proof: LedgerProof): Promise<boolean> {
    if (!this.baseUrl) return true;
    const url = this._url('/proofs/verify');
    try {
      const resp = await this._fetchJson<{ valid: boolean }>(url, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ proof }),
      });
      return Boolean(resp?.valid);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug('finance verifyLedgerProof failed:', (err as Error).message);
      return false;
    }
  }

  /**
   * health - basic health check against finance service
   */
  async health(): Promise<boolean> {
    if (!this.baseUrl) return false;
    const endpoints = ['/health', '/ping', '/status', '/'];
    for (const p of endpoints) {
      try {
        const url = this._url(p);
        const res = await fetch(url, { method: 'GET', headers: this._headers(), agent: this.agent });
        if (res.ok) return true;
      } catch {
        // continue
      }
    }
    return false;
  }
}

/* Singleton convenience instance */
export const financeClient = new FinanceClient();
export default financeClient;
