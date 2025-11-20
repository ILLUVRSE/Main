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
 *  - FINANCE_APPROVAL_ROLES    comma-separated roles required for proofs (default FinanceLead)
 *  - FINANCE_APPROVAL_SIGNER   signer id recorded in approvals (default marketplace-service)
 *  - FINANCE_ACTOR_ID          actor id recorded when calling settlement endpoints
 *
 * For local/dev use, if FINANCE_API_URL is not provided the client will synthesize
 * ledger proofs (non-production).
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import fetch, { RequestInit } from 'node-fetch';
import { mapOrderToJournal } from './royalties';

export type CreateLedgerPayload = {
  orderId: string;
  amount: number; // cents
  currency?: string;
  buyerId?: string;
  metadata?: Record<string, any>;
};

type OrderLike = {
  order_id: string;
  sku_id: string;
  buyer_id: string;
  amount: number;
  currency: string;
  delivery_mode?: string;
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
  private defaultRoles: string[];
  private defaultApprovals: Array<{ role: string; signer: string }>;
  private actorId: string;

  constructor() {
    this.baseUrl = process.env.FINANCE_API_URL;
    this.apiToken = process.env.FINANCE_API_TOKEN;
    this.actorId = process.env.FINANCE_ACTOR_ID || 'marketplace-service';
    this.defaultRoles = (process.env.FINANCE_APPROVAL_ROLES || 'FinanceLead').split(',').map((r) => r.trim()).filter(Boolean);
    if (!this.defaultRoles.length) {
      this.defaultRoles = ['FinanceLead'];
    }
    const approvalSigner = process.env.FINANCE_APPROVAL_SIGNER || 'marketplace-service';
    this.defaultApprovals = this.defaultRoles.map((role) => ({ role, signer: approvalSigner }));

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
    return this.settleOrder({
      order_id: payload.orderId,
      sku_id: payload.metadata?.sku_id || 'unknown',
      buyer_id: payload.buyerId || 'buyer',
      amount: payload.amount,
      currency: payload.currency || 'USD',
      delivery_mode: payload.metadata?.delivery_mode,
    });
  }

  supportsSettlement(): boolean {
    return !!this.baseUrl;
  }

  private formatLedgerProof(lp: any): LedgerProof {
    return {
      ledger_proof_id: lp.ledger_proof_id || lp.id || lp.proof_id || `ledger-${Date.now()}`,
      signer_kid: lp.signer_kid || lp.signerKid,
      signature: lp.signature || lp.signatures?.[0]?.signature,
      ts: lp.ts || lp.signedAt || lp.signatures?.[0]?.signedAt || new Date().toISOString(),
      payload: lp.proof || lp.payload || lp,
    };
  }

  private async buildJournal(order: OrderLike) {
    try {
      const journal = await mapOrderToJournal({
        order_id: order.order_id,
        sku_id: order.sku_id,
        amount: order.amount,
        currency: order.currency,
        buyer_id: order.buyer_id,
      });
      return journal;
    } catch (err) {
      throw new Error(`Failed to map order to journal: ${(err as Error).message}`);
    }
  }

  private async postLedger(journal: any) {
    if (!this.baseUrl) return;
    const url = this._url('/ledger/post');
    await this._fetchJson(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ entries: [journal] }),
    });
  }

  private async fetchProofById(proofId: string) {
    const url = this._url(`/proofs/${encodeURIComponent(proofId)}`);
    const resp = await this._fetchJson<{ proof: any }>(url, {
      method: 'GET',
      headers: this._headers(),
    });
    const proofPayload = resp?.proof || resp;
    return this.formatLedgerProof(proofPayload);
  }

  private async requestProof(from: string, to: string) {
    if (!this.baseUrl) {
      return this.formatLedgerProof({
        proof_id: `proof-${Date.now()}`,
        signer_kid: process.env.FINANCE_SIGNER_KID || 'finance-signer-v1',
        signature: Buffer.from(`proof:${Date.now()}`).toString('base64'),
        ts: new Date().toISOString(),
      });
    }
    const url = this._url('/proofs');
    const resp = await this._fetchJson<{ proof?: any; proof_id?: string }>(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ from, to, approvals: this.defaultApprovals, requiredRoles: this.defaultRoles }),
    });
    if (resp?.proof) {
      return this.formatLedgerProof(resp.proof);
    }
    if (resp?.proof_id) {
      return this.fetchProofById(resp.proof_id);
    }
    return this.formatLedgerProof(resp);
  }

  private synthProof(order: OrderLike): LedgerProof {
    const ledgerProofId = `ledger-sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signature = Buffer.from(`ledger:${ledgerProofId}`).toString('base64');
    return {
      ledger_proof_id: ledgerProofId,
      signer_kid: process.env.FINANCE_SIGNER_KID || 'finance-signer-v1',
      signature,
      ts: new Date().toISOString(),
      payload: {
        simulated: true,
        orderId: order.order_id,
        amount: order.amount,
      },
    };
  }

  private isNotFoundError(error: unknown) {
    if (!error) return false;
    const msg = String((error as Error).message || '').toLowerCase();
    return msg.includes('404');
  }

  async settleOrder(order: OrderLike): Promise<LedgerProof> {
    if (!this.baseUrl) {
      return this.synthProof(order);
    }

    const journal = await this.buildJournal(order);
    const body = {
      order_id: order.order_id,
      sku_id: order.sku_id,
      buyer_id: order.buyer_id,
      currency: order.currency || 'USD',
      delivery_mode: order.delivery_mode,
      journal,
      approvals: this.defaultApprovals,
      requiredRoles: this.defaultRoles,
      actor: this.actorId,
      idempotency_key: order.order_id,
    };

    try {
      const url = this._url('/settlement');
      const resp = await this._fetchJson<{ ledger_proof: any }>(url, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(body),
      });
      if (resp?.ledger_proof) {
        return this.formatLedgerProof(resp.ledger_proof);
      }
    } catch (err) {
      if (!this.isNotFoundError(err)) {
        throw err;
      }
      // fall through to manual flow
    }

    // Manual fallback: post ledger and request proof
    await this.postLedger(journal);
    return this.requestProof(journal.timestamp, journal.timestamp);
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
