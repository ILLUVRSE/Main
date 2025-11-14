import crypto from "crypto";

/**
 * Simple deterministic signing helper used for tests.
 * In production this would delegate to a proper KMS but for unit tests
 * we rely on an HMAC that produces stable output without external deps.
 */
function deriveSigningKey() {
  return process.env.REPOWRITER_SIGNING_SECRET || "repowriter-dev-secret";
}

export async function signManifest(manifest: object = {}): Promise<{ signedManifest: object; signature: string }> {
  const payload = JSON.stringify(manifest ?? {});
  const signature = crypto.createHmac("sha256", deriveSigningKey()).update(payload).digest("hex");
  return { signedManifest: manifest, signature };
}

export default { signManifest };
