// RepoWriter/server/kernel/sign.ts
//
// Manifest signer for RepoWriter.
//
// Behavior:
//  - If SIGNING_PROXY_URL is set, attempt to sign via proxy and return the proxy's base64 signature + signerId.
//  - If proxy fails and REQUIRE_SIGNING_PROXY==='1' then throw (fail-closed).
//  - Otherwise log a warning and fall back to the deterministic HMAC dev signer (keeps existing dev/CI behavior).
//
// Note: The signingProxyClient is implemented in ../src/services/signingProxyClient.ts
//       which must be present (we added it previously).

import crypto from "crypto";
import { signWithProxy } from "../src/services/signingProxyClient";

/**
 * deriveSigningKey
 * Dev fallback HMAC key. Kept for local dev/CI only.
 */
function deriveSigningKey() {
  return process.env.REPOWRITER_SIGNING_SECRET || "repowriter-dev-secret";
}

/**
 * signManifest
 * @param manifest object - manifest to be signed
 * @returns { signedManifest, signature, signerId? }
 *
 * - signature: base64 when proxy used, hex when HMAC fallback used
 * - signerId: present when signed via proxy
 */
export async function signManifest(manifest: object = {}): Promise<{
  signedManifest: object;
  signature: string;
  signerId?: string;
}> {
  const proxyUrl = (process.env.SIGNING_PROXY_URL || "").trim();

  if (proxyUrl) {
    try {
      const { signatureB64, signerId } = await signWithProxy(manifest);
      return { signedManifest: manifest, signature: signatureB64, signerId };
    } catch (err: any) {
      // Determine whether we must fail closed
      const requireProxy = process.env.REQUIRE_SIGNING_PROXY === "1";
      if (requireProxy) {
        // Fail loudly so production does not silently fall back.
        throw new Error(
          `Signing proxy error (REQUIRE_SIGNING_PROXY=1): ${String(err?.message ?? err)}`
        );
      }
      // Otherwise warn and fall back to HMAC for dev convenience.
      try {
        console.warn(
          "[signManifest] Signing proxy failed; falling back to HMAC dev signer. Error:",
          String(err?.message ?? err)
        );
      } catch {}
      // continue to fallback
    }
  }

  // Fallback deterministic HMAC signer (for dev / CI)
  const payload = JSON.stringify(manifest ?? {});
  const signatureHex = crypto
    .createHmac("sha256", deriveSigningKey())
    .update(payload)
    .digest("hex");

  return { signedManifest: manifest, signature: signatureHex };
}

export default { signManifest };

