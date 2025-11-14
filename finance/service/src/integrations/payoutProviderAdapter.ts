export interface SettlementRecord {
  payoutId: string;
  providerReference: string;
  status: 'pending' | 'settled' | 'failed';
}

export class PayoutProviderAdapter {
  constructor(private endpoint: string) {}

  async triggerPayout(request: {
    payoutId: string;
    amount: number;
    currency: string;
    destination: { provider: string; accountReference: string };
  }): Promise<SettlementRecord> {
    return {
      payoutId: request.payoutId,
      providerReference: `${request.destination.provider}_${request.destination.accountReference}`,
      status: 'pending',
    };
  }

  async fetchSettlementReport(from: string, to: string): Promise<SettlementRecord[]> {
    return [];
  }
}
