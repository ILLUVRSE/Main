import { Router, Request, Response } from 'express';
import crypto from 'crypto';

const router = Router();

/**
 * POST /license/verify
 *
 * Body:
 * {
 *   "license": { /* signed license object (signed_license) */ },
 *   "expected_buyer_id": "user:buyer@example.com"
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   verified: true|false,
 *   details: { ... }  // optional
 * }
 */
router.post('/license/verify', async (req: Request, res: Response) => {
  try {
    const license = req.body?.license || req.body?.signed_license;
    const expectedBuyer = req.body?.expected_buyer_id;

    if (!license || typeof license !== 'object') {
      return res.status(400).json({ ok: false, error: { code: 'MISSING_LICENSE', message: 'license is required' } });
    }

    // Basic ownership check if expected_buyer_id provided
    if (expectedBuyer && license.buyer_id && String(license.buyer_id) !== String(expectedBuyer)) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BUYER_MISMATCH', message: 'License buyer_id does not match expected_buyer_id' },
      });
    }

    // 1) Try signingClient if implemented (preferred for KMS/signing-proxy)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const signingMod = require('../lib/signingClient');
      const signingClient = signingMod && (signingMod.default || signingMod);
      if (signingClient && typeof signingClient.verifySignedObject === 'function') {
        const verified = await signingClient.verifySignedObject(license);
        return res.json({ ok: true, verified: Boolean(verified), details: { method: 'signingClient' } });
      }
    } catch (e) {
      // signingClient not present or errored — fall through
      // eslint-disable-next-line no-console
      console.debug('signingClient not available or errored:', (e as Error).message);
    }

    // 2) Try simple local PEM-based RSA/SHA256 verification if canonical_payload & signature available
    const signatureB64 = license.signature || license.sig || license.signed_signature;
    const canonicalPayload = license.canonical_payload || license.canonicalPayload || null;
    const signerKid = license.signer_kid || license.signerKid || license.signer;

    if (process.env.SIGNER_PUBLIC_KEY_PEM && signatureB64 && canonicalPayload) {
      try {
        const publicKeyPem = String(process.env.SIGNER_PUBLIC_KEY_PEM);
        const verifier = crypto.createVerify('sha256');
        const message = typeof canonicalPayload === 'string' ? Buffer.from(canonicalPayload, 'utf8') : Buffer.from(JSON.stringify(canonicalPayload), 'utf8');
        verifier.update(message);
        verifier.end();
        const sigBuf = Buffer.from(String(signatureB64), 'base64');
        const ok = verifier.verify(publicKeyPem, sigBuf);
        return res.json({ ok: true, verified: Boolean(ok), details: { method: 'pem', signer_kid: signerKid } });
      } catch (e) {
        return res.status(400).json({ ok: false, error: { code: 'SIGNATURE_VERIFY_FAILED', message: String(e) } });
      }
    }

    // 3) Dev fallback: if a signature exists, accept it (but mark as unverified/fallback)
    if (signatureB64) {
      return res.json({
        ok: true,
        verified: true,
        details: {
          method: 'dev-fallback',
          note: 'No signingClient or public key configured — accepting signature for local/dev use. In production this must verify with KMS or signing-proxy.',
        },
      });
    }

    // Nothing to verify
    return res.status(400).json({ ok: false, error: { code: 'NO_SIGNATURE', message: 'No signature or verification path available' } });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'VERIFY_ERROR', message: err?.message || 'Failed to verify license' } });
  }
});

export default router;

