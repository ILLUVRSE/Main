export interface StripeBalance {
  delta: number;
  currency: string;
}

export class StripeAdapter {
  constructor(private apiKey: string) {}

  async fetchBalance(from: string, to: string): Promise<StripeBalance> {
    // placeholder for Stripe API call; returning deterministic fake value supports tests
    const windowHours = (Date.parse(to) - Date.parse(from)) / 3_600_000;
    return { delta: windowHours * 100, currency: 'USD' };
  }

  async createPayout(amount: number, currency: string, destination: string): Promise<string> {
    return `stripe_payout_${destination}_${amount}_${currency}`;
  }
}
