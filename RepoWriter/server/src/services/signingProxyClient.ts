// RepoWriter/server/src/services/signingProxyClient.ts
// Minimal signing-proxy client for RepoWriter.
// Contract:
//   Request:  POST { payload_b64 }
//   Response: { signature_b64, signer_id }
// The function returns { signatureB64, signerId } or throws on error.

export type SigningProxyResult = {
  signatureB64: string;
  signerId: string;
};

function assertFetchAvailable() {
  if (typeof fetch === "undefined") {
    throw new Error(
      "Global fetch is not available. Node 18+ is required or install a fetch polyfill (undici/node-fetch)."
    );
  }
}

/**
 * signWithProxy
 * @param manifest - the manifest object to sign
 * @throws if SIGNING_PROXY_URL not set or proxy returns non-OK / malformed response
 */
export async function signWithProxy(manifest: object): Promise<SigningProxyResult> {
  const base = (process.env.SIGNING_PROXY_URL || "").trim();
  if (!base) {
    throw new Error("SIGNING_PROXY_URL not configured");
  }

  assertFetchAvailable();

  const url = base.replace(/\/$/, "") + "/sign";
  const apiKey = process.env.SIGNING_PROXY_API_KEY;

  // canonicalize payload
  const payload_b64 = Buffer.from(JSON.stringify(manifest ?? {})).toString("base64");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ payload_b64 }),
  });

  if (!res.ok) {
    // try to read body for better diagnostics
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`Signing proxy returned ${res.status}: ${text}`);
  }

  const j = await res.json().catch(() => ({}));

  // support several common response shapes
  const sig =
    j.signature_b64 || j.signatureB64 || j.signature || j.signatureBase64 || j.signature_base64;
  const signer = j.signer_id || j.signerId || j.signer;

  if (!sig || !signer) {
    throw new Error("Invalid response from signing proxy: missing signature_b64 or signer_id");
  }

  return {
    signatureB64: sig,
    signerId: signer,
  };
}

export default { signWithProxy };

