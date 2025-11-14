import fetch, { RequestInit } from 'node-fetch';

export interface SettlementRecord {
  payoutId: string;
  providerReference: string;
  status: 'pending' | 'settled' | 'failed';
  settledAt?: string;
}

export interface TriggerPayoutRequest {
  payoutId: string;
  amount: number;
  currency: string;
  destination: { provider: string; accountReference: string };
  memo?: string;
}

export interface PayoutProviderAdapterOptions {
  endpoint: string;
  authToken?: string;
  timeoutMs?: number;
}

export class PayoutProviderAdapter {
  constructor(private readonly options: PayoutProviderAdapterOptions) {
    if (!options.endpoint) throw new Error('Payout provider endpoint required');
  }

  async triggerPayout(request: TriggerPayoutRequest): Promise<SettlementRecord> {
    const res = await this.fetchJson<SettlementRecord>(`/payouts`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return res;
  }

  async fetchSettlementReport(from: string, to: string): Promise<SettlementRecord[]> {
    const params = new URLSearchParams({ from, to }).toString();
    return this.fetchJson<SettlementRecord[]>(`/settlements?${params}`);
  }

  private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15000);
    const headers = {
      'content-type': 'application/json',
      ...(this.options.authToken ? { authorization: `Bearer ${this.options.authToken}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    try {
      const url = this.buildUrl(path);
      const response = await fetch(url, { ...init, headers, signal: controller.signal });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Payout provider error ${response.status}: ${body}`);
      }
      if (response.status === 204) {
        return {} as T;
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUrl(path: string): string {
    const base = this.options.endpoint.replace(/\/$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }
}
