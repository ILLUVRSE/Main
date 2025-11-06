import path from 'path';

export interface KmsConfig {
  endpoint?: string;
  signerId: string;
  requireKms: boolean;
  bearerToken?: string;
  mtlsCertPath?: string;
  mtlsKeyPath?: string;
  timeoutMs: number;
}

/**
 * loadKmsConfig centralises configuration needed by the signing provider.
 * Environment variables are resolved once at module load to keep behaviour
 * consistent with existing tests that rely on jest.resetModules().
 */
export function loadKmsConfig(): KmsConfig {
  const endpoint = (process.env.KMS_ENDPOINT || '').replace(/\/$/, '') || undefined;
  const signerId = process.env.SIGNER_ID || 'kernel-signer-local';
  const requireKms = (process.env.REQUIRE_KMS || 'false').toLowerCase() === 'true';
  const bearerToken = process.env.KMS_BEARER_TOKEN || undefined;
  const mtlsCertPath = process.env.KMS_MTLS_CERT_PATH ? path.resolve(process.env.KMS_MTLS_CERT_PATH) : undefined;
  const mtlsKeyPath = process.env.KMS_MTLS_KEY_PATH ? path.resolve(process.env.KMS_MTLS_KEY_PATH) : undefined;
  const timeoutMs = Number(process.env.KMS_TIMEOUT_MS || 5000);

  return {
    endpoint,
    signerId,
    requireKms,
    bearerToken,
    mtlsCertPath,
    mtlsKeyPath,
    timeoutMs,
  };
}

export default loadKmsConfig;
