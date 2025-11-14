"use client";

import config from "./config";

export type ApprovalSignaturePayload = {
  upgradeId: string;
  manifestHash: string;
  approverId: string;
  approverRole: string;
  emergency?: boolean;
  notes?: string;
};

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function devSign(payload: ApprovalSignaturePayload): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash);
}

export async function signApproval(payload: ApprovalSignaturePayload): Promise<string> {
  if (config.signingProxyUrl) {
    const resp = await fetch(`${config.signingProxyUrl}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || "signing proxy error");
    }
    const body = await resp.json();
    if (!body?.signature) {
      throw new Error("signing proxy returned no signature");
    }
    return body.signature as string;
  }
  return devSign(payload);
}
