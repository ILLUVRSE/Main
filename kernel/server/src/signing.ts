import crypto from 'node:crypto';

export interface SigningBackend {
  signDigest(digestHex: string): Promise<{ signature: string; signerId: string }>;
  checkHealth(): Promise<void>;
}

const DEV_SIGNING_SECRET = process.env.DEV_SIGNING_SECRET || 'kernel-dev-signing-secret';

function requireSigning(): boolean {
  return (
    (process.env.NODE_ENV || 'development') === 'production' ||
    String(process.env.REQUIRE_KMS).toLowerCase() === 'true' ||
    String(process.env.REQUIRE_SIGNING_PROXY).toLowerCase() === 'true'
  );
}

function signingConfigured(): boolean {
  return Boolean(
    process.env.SIGNING_PROXY_URL ||
      process.env.KMS_ENDPOINT ||
      process.env.KMS_KEY_ID ||
      process.env.AWS_KMS_KEY_ID
  );
}

export function createSigningBackend(): SigningBackend {
  const signerId = process.env.AUDIT_SIGNER_KID || 'dev-signer';

  return {
    async signDigest(digestHex: string) {
      if (!digestHex || !/^[a-f0-9]{64}$/i.test(digestHex)) {
        throw new Error('signDigest expects a 64 character hex digest');
      }
      const signature = crypto
        .createHmac('sha256', DEV_SIGNING_SECRET)
        .update(Buffer.from(digestHex, 'hex'))
        .digest('base64');
      return { signature, signerId };
    },
    async checkHealth() {
      if (requireSigning() && !signingConfigured()) {
        throw new Error('Signing backend required but not configured');
      }
    }
  };
}
