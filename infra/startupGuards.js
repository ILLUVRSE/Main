/**
 * infra/startupGuards.js
 *
 * Shared helper used by services to enforce production-only guards
 * (REQUIRE_KMS / REQUIRE_SIGNING_PROXY / REQUIRE_MTLS). Call this as early
 * as possible in each service entrypoint right after loading environment
 * variables so the process fails fast when required infra is missing.
 */

'use strict';

/**
 * @typedef {{ error: (msg: string) => void }} Logger
 * @typedef {{ serviceName?: string, logger?: Logger, exit?: (code: number) => never }} StartupGuardOptions
 */

const TRUE_SET = new Set(['true', '1', 'yes', 'y']);

const defaultExit = (code) => {
  process.exit(code);
};

const toBool = (value) => {
  if (!value) return false;
  return TRUE_SET.has(String(value).toLowerCase());
};

const envEntries = () =>
  Object.entries(process.env || {}).filter(([, value]) => typeof value === 'string' && value.length > 0);

/**
 * @param {StartupGuardOptions} [options]
 */
function enforceStartupGuards(options = {}) {
  const logger = options.logger || console;
  const exitFn = options.exit || defaultExit;
  const serviceName = options.serviceName || process.env.SERVICE_NAME || 'service';
  const nodeEnv = process.env.NODE_ENV || 'development';

  const errors = [];
  const requireKms = toBool(process.env.REQUIRE_KMS);
  const requireProxy = toBool(process.env.REQUIRE_SIGNING_PROXY);
  const requireMtls = toBool(process.env.REQUIRE_MTLS);
  const guardEnabled = nodeEnv === 'production' || requireKms || requireProxy || requireMtls;

  if (!guardEnabled) {
    return;
  }

  const entries = envEntries();
  const mtlsShouldBeEnforced = nodeEnv === 'production' || requireMtls;
  if (mtlsShouldBeEnforced) {
    if (!requireMtls) {
      errors.push('REQUIRE_MTLS=true must be set when running in production to enforce service mTLS.');
    }
    if (!process.env.MTLS_CA_CERT && !process.env.MTLS_CA_BUNDLE) {
      errors.push('mTLS guard enabled but MTLS_CA_CERT or MTLS_CA_BUNDLE is not configured.');
    }
  }

  if (nodeEnv === 'production' && !requireKms && !requireProxy) {
    errors.push('At least one of REQUIRE_KMS=true or REQUIRE_SIGNING_PROXY=true must be set in production.');
  }

  if (requireKms) {
    const kmsKeyConfigured =
      entries.some(([key, value]) => Boolean(value) && /KMS_KEY(_ID)?$/i.test(key)) ||
      Boolean(process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY);

    const kmsEndpointConfigured = entries.some(([key, value]) => Boolean(value) && /KMS_ENDPOINT$/i.test(key));
    const awsRegionConfigured = entries.some(([key, value]) => Boolean(value) && /AWS(_DEFAULT)?_REGION$/i.test(key));

    if (!kmsKeyConfigured) {
      errors.push('REQUIRE_KMS=true but no *_KMS_KEY_ID (or AUDIT_SIGNING_KMS_KEY) environment variable is set.');
    }
    if (!kmsEndpointConfigured && !awsRegionConfigured) {
      errors.push('REQUIRE_KMS=true but no AWS region or KMS endpoint override is configured.');
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

module.exports = {
  enforceStartupGuards,
};
