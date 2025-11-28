/**
 * kernel/src/signingProxy.ts
 *
 * Production-minded KMS signing proxy client for Kernel.
 *
 * - Uses KMS_ENDPOINT (required when REQUIRE_KMS=true) to sign manifests and arbitrary data.
 * - Supports Bearer token auth (KMS_BEARER_TOKEN) or mTLS auth via cert/key files (KMS_MTLS_CERT_PATH,
 *   KMS_MTLS_KEY_PATH). If both are provided, mTLS is preferred.
 * - If REQUIRE_KMS is true and KMS_ENDPOINT is missing/unreachable -> throws (fail-fast).
 * - Local ephemeral Ed25519 fallback only used when REQUIRE_KMS !== 'true' and KMS is missing/unavailable.
 *
 * NOTE: DO NOT COMMIT SECRETS. Use host secret manager for KMS creds/certs and POSTGRES_URL, etc.
 */

import { ManifestSignature } from './types';
import loadKmsConfig from './config/kms';
import {
  createSigningProvider,
  LocalSigningProvider,
  prepareDataSigningRequest,
  prepareManifestSigningRequest,
  SigningProvider,
} from './signingProvider';

const kmsConfig = loadKmsConfig();
const kmsProvider: SigningProvider | null = kmsConfig.endpoint
  ? createSigningProvider(kmsConfig, 'kms')
  : null;
const localProvider = new LocalSigningProvider(kmsConfig.signerId);

export async function signManifest(manifest: any): Promise<ManifestSignature> {
  const request = prepareManifestSigningRequest(manifest);

  if (!kmsProvider) {
    if (kmsConfig.requireKms) {
      throw new Error('REQUIRE_KMS=true but KMS_ENDPOINT is not configured');
    }
    return localProvider.signManifest(manifest, request);
  }

  try {
    return await kmsProvider.signManifest(manifest, request);
  } catch (err) {
    const msg = (err as Error).message || err;
    console.error('signingProxy: KMS signManifest failed:', msg);
    if (kmsConfig.requireKms) {
      throw new Error(`KMS signing failed and REQUIRE_KMS=true: ${msg}`);
    }
    console.warn('signingProxy: falling back to local ephemeral signing (dev only)');
    return localProvider.signManifest(manifest, request);
  }
}

export async function signData(data: string, request?: any): Promise<{ signature: string; signerId: string }> {
  const prepared = request || prepareDataSigningRequest(data);

  if (!kmsProvider) {
    if (kmsConfig.requireKms) {
      throw new Error('REQUIRE_KMS=true but KMS_ENDPOINT is not configured');
    }
    return localProvider.signData(data, prepared);
  }

  try {
    if (!kmsProvider.signData) {
      throw new Error('signData not supported by signing provider');
    }
    return await kmsProvider.signData(data, prepared);
  } catch (err) {
    const msg = (err as Error).message || err;
    console.error('signingProxy: KMS signData failed:', msg);
    if (kmsConfig.requireKms) {
      throw new Error(`KMS signData failed and REQUIRE_KMS=true: ${msg}`);
    }
    console.warn('signingProxy: falling back to local ephemeral signing (dev only)');
    return localProvider.signData(data, prepared);
  }
}

/**
 * Exported proxy object
 */
const signingProxy = {
  signManifest,
  signData,
  // expose config for testing/inspection
  _internal: {
    KMS_ENDPOINT: kmsConfig.endpoint,
    SIGNER_ID: kmsConfig.signerId,
    REQUIRE_KMS: kmsConfig.requireKms,
    KMS_BEARER_TOKEN: !!kmsConfig.bearerToken,
    KMS_MTLS_CERT_PATH: kmsConfig.mtlsCertPath,
    KMS_MTLS_KEY_PATH: kmsConfig.mtlsKeyPath,
  },
};

export default signingProxy;

/**
 * Acceptance criteria (short, testable):
 *
 * - When KMS_ENDPOINT is configured and reachable, signManifest calls KMS /sign and returns a ManifestSignature
 *   that includes id, manifestId, signerId, signature (base64), version, ts, prevHash.
 *   Test: Start a mock HTTP server that responds to /sign with expected fields and assert signManifest returns mapped fields.
 *
 * - When REQUIRE_KMS=true and KMS_ENDPOINT is missing or KMS returns error, signManifest and signData throw.
 *   Test: set REQUIRE_KMS=true, unset KMS_ENDPOINT, call signManifest -> expect thrown error.
 *
 * - When REQUIRE_KMS is false/unset and KMS is not configured, signManifest and signData perform local ephemeral Ed25519 signing
 *   and return base64 signature (dev only). Test: unset REQUIRE_KMS and KMS_ENDPOINT and assert signManifest returns signature.
 *
 * - mTLS support: When KMS_MTLS_CERT_PATH and KMS_MTLS_KEY_PATH point to cert/key files, httpPostJson will use an https.Agent
 *   with the provided cert/key so the KMS can require client cert authentication. Test: run a mock TLS server requiring client cert and verify call succeeds.
 *
 * - Bearer token support: When KMS_BEARER_TOKEN is configured, Authorization: Bearer <token> is sent in requests.
 *
 * Security note: never rely on local ephemeral signing in production; ensure KMS is used and rails enforce REQUIRE_KMS=true in production CI/CD.
 *
 * Next file to update after saving this: kernel/src/routes/kernelRoutes.ts (apply RBAC and Sentinel policy enforcement).
 */

