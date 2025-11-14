import Stripe from 'stripe';

export interface StripeAdapterConfig {
  apiKey: string;
  webhookSecret: string;
  apiBase?: string;
  maxPages?: number;
}

export interface StripeBalance {
  delta: number;
  currency: string;
}

export class StripeAdapter {
  private readonly client: Stripe;
  private readonly webhookSecret: string;
  private readonly maxPages: number;

  constructor(private readonly config: StripeAdapterConfig) {
    if (!config.apiKey) throw new Error('Stripe API key required');
    this.webhookSecret = config.webhookSecret;
    this.maxPages = config.maxPages ?? 5;
    const apiVersion: Stripe.LatestApiVersion = '2020-08-27';
    const clientConfig: Stripe.StripeConfig = {
      apiVersion,
    };
    if (config.apiBase) {
      const url = new URL(config.apiBase);
      clientConfig.host = url.hostname;
      clientConfig.port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
      clientConfig.protocol = url.protocol.replace(':', '') as 'http' | 'https';
      clientConfig.basePath = url.pathname && url.pathname !== '/' ? url.pathname : undefined;
    }
    this.client = new Stripe(config.apiKey, clientConfig);
  }

  async fetchBalance(from: string, to: string): Promise<StripeBalance> {
    const created = { gte: Math.floor(Date.parse(from) / 1000), lte: Math.floor(Date.parse(to) / 1000) };
    let startingAfter: string | undefined;
    let delta = 0;
    let currency = 'usd';
    for (let page = 0; page < this.maxPages; page += 1) {
      const txs = await this.client.balanceTransactions.list({
        created,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const tx of txs.data) {
        delta += tx.amount;
        currency = tx.currency;
      }
      if (!txs.has_more || !txs.data.length) break;
      startingAfter = txs.data[txs.data.length - 1].id;
    }
    return { delta, currency: currency.toUpperCase() };
  }

  async createPayout(amount: number, currency: string, destination: string): Promise<string> {
    const payout = await this.client.payouts.create({ amount, currency, destination });
    return payout.id;
  }

  handleWebhook(payload: Buffer | string, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new Error('Stripe webhook secret not configured');
    }
    const body = typeof payload === 'string' ? payload : payload.toString('utf8');
    return this.client.webhooks.constructEvent(body, signature, this.webhookSecret);
  }
}
