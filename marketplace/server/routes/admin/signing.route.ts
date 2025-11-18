/**
 * marketplace/server/routes/admin/signing.route.ts
 *
 * Admin routes to inspect and manage signing-related concerns:
 *  - GET  /admin/signing         -> info about configured signing path and health
 *  - POST /admin/signing/rotate  -> request a signer "rotation" (operator-only)
 *
 * Operator authorization is required (same lightweight check as signers.route).
 * This route is intentionally conservative: it does not perform key material
 * rotation itself (that must be done via KMS or a signing proxy). Instead it:
 *  - allows an operator to mark a signer as deployed/rotated (update deployedAt)
 *  - publishes signers to Kernel (via signerRegistry.publishSignersToKernel) as a convenience
 *
 * For production you will likely replace publishSignersToKernel with a real Kernel API call.
 */

import { Router, Request, Response } from 'express';
import signerRegistry from '../../lib/signerRegistry';
import kmsClient from '../../lib/kmsClient';
import signingProxyClient from '../../lib/signingProxyClient';

const router = Router();

function isOperatorAuthorized(req: Request): boolean {
  const auth = String(req.header('Authorization') || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return false;

  const controlToken = process.env.KERNEL_CONTROL_PANEL_TOKEN || '';
  if (controlToken && token === controlToken) return true;

  // Dev convenience: allow tokens containing 'operator'
  if (process.env.NODE_ENV !== 'production' && token.toLowerCase().includes('operator')) return true;

  return false;
}

/* GET /admin/signing */
router.get('/admin/signing', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  try {
    const signers = await signerRegistry.listSigners();

    // Determine signing mode
    let signing_mode: 'proxy' | 'kms' | 'disabled' = 'disabled';
    if (process.env.SIGNING_PROXY_URL) signing_mode = 'proxy';
    else if (process.env.AWS_KMS_KEY_ID) signing_mode = 'kms';

    // Health checks (best-effort)
    let proxyHealthy = false;
    try {
      proxyHealthy = signingProxyClient.isConfigured() ? await signingProxyClient.health() : false;
    } catch (e) {
      proxyHealthy = false;
    }

    let kmsPublicKey: string | null = null;
    let kmsOk = false;
    if (signing_mode === 'kms') {
      try {
        const pub = await kmsClient.getPublicKey();
        kmsPublicKey = (pub && pub.publicKeyPem) ? pub.publicKeyPem : null;
        kmsOk = !!kmsPublicKey;
      } catch (e) {
        kmsPublicKey = null;
        kmsOk = false;
      }
    }

    return res.json({
      ok: true,
      signing_mode,
      signing_proxy: {
        configured: signingProxyClient.isConfigured(),
        healthy: proxyHealthy,
        url: process.env.SIGNING_PROXY_URL || null,
      },
      kms: {
        configured: !!process.env.AWS_KMS_KEY_ID,
        healthy: kmsOk,
        public_key_pem: kmsPublicKey,
        kms_key_id: process.env.AWS_KMS_KEY_ID || null,
      },
      signers,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('GET /admin/signing failed:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to get signing info', details: String(err) } });
  }
});

/* POST /admin/signing/rotate
 * Body: { signer_kid: string, comment?: string }
 *
 * This is an operator convenience endpoint that:
 *  - marks the signer entry's deployedAt to now (indicating rotation deployed)
 *  - republishes signers to Kernel (via signerRegistry.publishSignersToKernel) if available
 *
 * NOTE: Actual key-material rotation must be done in KMS or signing-proxy and requires
 * appropriate operational steps outside this endpoint.
 */
router.post('/admin/signing/rotate', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  const body = req.body || {};
  const signer_kid = (body.signer_kid || '').toString().trim();
  const comment = body.comment ? String(body.comment) : undefined;

  if (!signer_kid) {
    return res.status(400).json({ ok: false, error: { message: 'signer_kid is required' } });
  }

  try {
    // Fetch current signers
    const signers = await signerRegistry.listSigners();

    // Try to find the target signer and update deployedAt
    const existing = signers.find((s) => s.signer_kid === signer_kid);
    if (!existing) {
      return res.status(404).json({ ok: false, error: { message: `signer ${signer_kid} not found` } });
    }

    const updated = {
      ...existing,
      comment: comment ?? existing.comment ?? null,
      deployedAt: new Date().toISOString(),
    };

    // AddSigner replaces existing entry (keeps it at front)
    await signerRegistry.addSigner(updated);

    // Optionally publish to Kernel (best-effort; stub implementation may be a no-op)
    let published = null;
    try {
      published = await signerRegistry.publishSignersToKernel(await signerRegistry.listSigners());
    } catch (e) {
      // publishing failed; record but don't abort the rotation
      // eslint-disable-next-line no-console
      console.warn('publishSignersToKernel failed during rotation:', e && (e as Error).message ? (e as Error).message : e);
      published = null;
    }

    return res.json({ ok: true, rotated: true, signer: updated, published });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('POST /admin/signing/rotate failed:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to rotate signer', details: String(err) } });
  }
});

export default router;

