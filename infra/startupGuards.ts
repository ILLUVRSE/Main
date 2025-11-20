/**
 * infra/startupGuards.ts
 *
 * Shared helper used by services to enforce production-only guards
 * (REQUIRE_KMS / REQUIRE_SIGNING_PROXY / REQUIRE_MTLS). Call this as early
 * as possible in each service entrypoint right after loading environment
 * variables so the process fails fast when required infra is missing.
 */

type Logger = Pick<Console, 'error'>;

export interface StartupGuardOptions {
  serviceName?: string;
  logger?: Logger;
  exit?: (code: number) => never;
}

const TRUE_SET = new Set(['true', '1', 'yes', 'y']);

const defaultExit = (code: number) => {
  process.exit(code);
};

function toBool(value?: string | null): boolean {
  if (!value) return false;
  return TRUE_SET.has(value.toLowerCase());
}

export function enforceStartupGuards(options: StartupGuardOptions = {}): void {
  const logger = options.logger || console;
  const exitFn = options.exit || defaultExit;
  const serviceName = options.serviceName || process.env.SERVICE_NAME || 'service';
  const nodeEnv = process.env.NODE_ENV || 'development';

  if (nodeEnv !== 'production') {
    return;
  }

  const errors: string[] = [];
  const requireKms = toBool(process.env.REQUIRE_KMS);
  const requireProxy = toBool(process.env.REQUIRE_SIGNING_PROXY);
  const requireMtls = toBool(process.env.REQUIRE_MTLS);

  if (!requireMtls) {
    errors.push('REQUIRE_MTLS=true must be set in production to enforce mTLS between services.');
  } else if (!process.env.MTLS_CA_CERT && !process.env.MTLS_CA_BUNDLE) {
    errors.push('mTLS guard enabled but MTLS_CA_CERT or MTLS_CA_BUNDLE is not configured.');
  }

  if (!requireKms && !requireProxy) {
    errors.push('At least one of REQUIRE_KMS=true or REQUIRE_SIGNING_PROXY=true must be set in production.');
  }

  if (requireKms) {
    if (!process.env.KMS_KEY_ID) {
      errors.push('REQUIRE_KMS=true but KMS_KEY_ID is missing.');
    }
    if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION && !process.env.KMS_ENDPOINT) {
      errors.push('REQUIRE_KMS=true but no AWS region or KMS_ENDPOINT override is configured.');
    }
  }

  if (requireProxy && !process.env.SIGNING_PROXY_URL) {
    errors.push('REQUIRE_SIGNING_PROXY=true but SIGNING_PROXY_URL is missing.');
  }

  if (errors.length) {
    logger.error(`[startup-guards:${serviceName}] Configuration errors detected:`);
    errors.forEach((msg) => logger.error(` - ${msg}`));
    exitFn(1);
  }
}
