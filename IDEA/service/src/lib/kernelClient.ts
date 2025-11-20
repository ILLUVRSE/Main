import { getConfig } from '../config';

const cfg = getConfig();

export interface KernelSignResponse {
  manifest_signature_id: string;
  signature: string;
  signer_kid: string;
  payload: Record<string, unknown>;
}

export async function submitManifestForSigning(manifestId: string, payload: Record<string, unknown>): Promise<KernelSignResponse> {
  const response = await fetch(`${cfg.kernelApiUrl}/manifests/sign`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ manifest_id: manifestId, payload })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kernel sign request failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<KernelSignResponse>;
}
