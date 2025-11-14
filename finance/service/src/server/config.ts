import dotenv from 'dotenv';

dotenv.config();

export interface FinanceConfig {
  port: number;
  databaseUrl: string;
  ledgerRepo: 'inmemory' | 'postgres';
  awsRegion: string;
  kmsEndpoint?: string;
  kmsKeyId?: string;
  stripe: {
    apiKey: string;
    webhookSecret: string;
    apiBase?: string;
  };
  payout: {
    endpoint: string;
    authToken?: string;
  };
  storage: {
    bucket: string;
  };
  tls: {
    enabled: boolean;
    certPath?: string;
    keyPath?: string;
  };
}

export function loadConfig(): FinanceConfig {
  const env = process.env;
  return {
    port: Number(env.FINANCE_PORT ?? env.PORT ?? 8443),
    databaseUrl: env.FINANCE_DATABASE_URL ?? env.DATABASE_URL ?? 'postgres://finance:finance@localhost:5432/finance',
    ledgerRepo: (env.LEDGER_REPO ?? 'inmemory') as 'inmemory' | 'postgres',
    awsRegion: env.AWS_REGION ?? 'us-east-1',
    kmsEndpoint: env.KMS_ENDPOINT ?? env.FINANCE_KMS_ENDPOINT,
    kmsKeyId: env.KMS_KEY_ID ?? env.AWS_KMS_KEY_ID,
    stripe: {
      apiKey: env.STRIPE_API_KEY ?? env.FINANCE_STRIPE_KEY ?? 'sk_test_12345',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test',
      apiBase: env.STRIPE_API_BASE,
    },
    payout: {
      endpoint: env.PAYOUT_PROVIDER_ENDPOINT ?? env.FINANCE_PAYOUT_ENDPOINT ?? 'http://localhost:4100',
      authToken: env.PAYOUT_PROVIDER_TOKEN,
    },
    storage: {
      bucket: env.S3_AUDIT_BUCKET ?? 'finance-audit',
    },
    tls: {
      enabled: env.FINANCE_TLS_ENABLED !== 'false',
      certPath: env.FINANCE_TLS_CERT,
      keyPath: env.FINANCE_TLS_KEY,
    },
  };
}
