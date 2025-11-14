import dotenv from 'dotenv';

dotenv.config();

export interface FinanceConfig {
  port: number;
  databaseUrl: string;
  kmsEndpoint: string;
  stripeKey: string;
  payoutEndpoint: string;
  tls: {
    enabled: boolean;
    certPath?: string;
    keyPath?: string;
  };
}

export function loadConfig(): FinanceConfig {
  return {
    port: Number(process.env.FINANCE_PORT ?? 8443),
    databaseUrl: process.env.FINANCE_DATABASE_URL ?? 'postgres://finance:finance@localhost:5432/finance',
    kmsEndpoint: process.env.FINANCE_KMS_ENDPOINT ?? 'kms.local',
    stripeKey: process.env.FINANCE_STRIPE_KEY ?? 'sk_test',
    payoutEndpoint: process.env.FINANCE_PAYOUT_ENDPOINT ?? 'https://payout.local',
    tls: {
      enabled: process.env.FINANCE_TLS_ENABLED !== 'false',
      certPath: process.env.FINANCE_TLS_CERT,
      keyPath: process.env.FINANCE_TLS_KEY,
    },
  };
}
