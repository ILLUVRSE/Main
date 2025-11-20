import { enforceStartupGuards } from './startupGuards';

const baseEnv = { ...process.env };

const makeExitStub = () =>
  ((code: number) => {
    throw new Error(`exit:${code}`);
  }) as (code: number) => never;

const loggerFactory = () => {
  const messages: string[] = [];
  return {
    logger: {
      error: (msg: string) => {
        messages.push(msg);
      },
    },
    messages,
  };
};

function withEnv(env: NodeJS.ProcessEnv, fn: () => void) {
  const previous = process.env;
  process.env = { ...baseEnv, ...env };
  try {
    fn();
  } finally {
    process.env = previous;
  }
}

describe('enforceStartupGuards', () => {
  it('is a no-op in development when no guards are requested', () => {
    withEnv(
      {
        NODE_ENV: 'development',
        REQUIRE_KMS: 'false',
        REQUIRE_SIGNING_PROXY: 'false',
        REQUIRE_MTLS: 'false',
      },
      () => {
        const { logger } = loggerFactory();
        expect(() => enforceStartupGuards({ serviceName: 'test', logger, exit: makeExitStub() })).not.toThrow();
      }
    );
  });

  it('fails fast when REQUIRE_KMS=true but no kms key env is present', () => {
    withEnv(
      {
        NODE_ENV: 'development',
        REQUIRE_KMS: 'true',
        AWS_REGION: 'us-east-1',
        REQUIRE_SIGNING_PROXY: 'false',
        REQUIRE_MTLS: 'false',
      },
      () => {
        const { logger, messages } = loggerFactory();
        expect(() => enforceStartupGuards({ serviceName: 'test', logger, exit: makeExitStub() })).toThrow(/exit:/);
        expect(messages.some((msg) => msg.includes('no *_KMS_KEY_ID'))).toBe(true);
      }
    );
  });

  it('fails when running in production without REQUIRE_MTLS', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        REQUIRE_KMS: 'true',
        AWS_REGION: 'us-east-1',
        AUDIT_SIGNING_KMS_KEY_ID: 'arn:aws:kms:us-east-1:123456789012:key/abc',
        REQUIRE_SIGNING_PROXY: 'false',
        REQUIRE_MTLS: 'false',
      },
      () => {
        const { logger, messages } = loggerFactory();
        expect(() => enforceStartupGuards({ serviceName: 'test', logger, exit: makeExitStub() })).toThrow(/exit:/);
        expect(messages.some((msg) => msg.includes('REQUIRE_MTLS'))).toBe(true);
      }
    );
  });

  it('passes when all required signing + mTLS configuration is present', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        REQUIRE_KMS: 'true',
        REQUIRE_SIGNING_PROXY: 'true',
        REQUIRE_MTLS: 'true',
        AWS_REGION: 'us-east-1',
        AUDIT_SIGNING_KMS_KEY_ID: 'arn:aws:kms:us-east-1:123456789012:key/abc',
        SIGNING_PROXY_URL: 'https://signer.example.com',
        MTLS_CA_CERT: '-----BEGIN CERTIFICATE-----mock-----END CERTIFICATE-----',
      },
      () => {
        const { logger } = loggerFactory();
        expect(() => enforceStartupGuards({ serviceName: 'test', logger, exit: makeExitStub() })).not.toThrow();
      }
    );
  });
});
