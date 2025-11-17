import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * Simple operator auth helper for admin endpoints.
 * Accepts either:
 *  - Bearer token matching KERNEL_CONTROL_PANEL_TOKEN
 *  - In dev, any Bearer token containing 'operator'
 */
function isOperatorAuthorized(req: Request) {
  const auth = String(req.header('Authorization') || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return false;
  const controlToken = process.env.KERNEL_CONTROL_PANEL_TOKEN || '';
  if (controlToken && token === controlToken) return true;
  if (process.env.NODE_ENV !== 'production' && token.toLowerCase().includes('operator')) return true;
  return false;
}

/**
 * POST /admin/validate-manifest
 * Body: { manifest: { ... } }
 *
 * Response: { ok: true, valid: true/false, manifestSignatureId?: string, details?: {...} }
 */
router.post('/validate-manifest', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: 'Operator authorization required' } });
  }

  const manifest = req.body?.manifest;
  if (!manifest || typeof manifest !== 'object') {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_MANIFEST', message: 'manifest is required' } });
  }

  // Prefer using a manifestValidator implementation (production)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const validatorMod = require('../lib/manifestValidator');
    const validator = validatorMod && (validatorMod.default || validatorMod);
    if (validator && typeof validator.validateManifest === 'function') {
      const validation = await validator.validateManifest(manifest);
      // Validation object expected shape: { valid: boolean, manifestSignatureId?: string, details?: {...} }
      return res.json({
        ok: true,
        valid: Boolean(validation && validation.valid),
        manifestSignatureId: validation?.manifestSignatureId || validation?.manifest_signature_id || undefined,
        details: validation?.details || validation,
      });
    }
  } catch (e) {
    // validator not present — fall through to best-effort validation
    // eslint-disable-next-line no-console
    console.debug('manifestValidator not available:', (e as Error).message);
  }

  // Best-effort local validation (dev-friendly)
  try {
    const required = ['id', 'title', 'version', 'checksum', 'author', 'manifest_signature', 'artifacts'];
    const missing = required.filter((k) => !(k in manifest));
    if (missing.length > 0) {
      return res.json({ ok: true, valid: false, details: { missing } });
    }

    // Basic checks on manifest_signature
    const sig = manifest.manifest_signature || manifest.manifestSignature || {};
    if (!sig.signature || !sig.signer_kid) {
      return res.json({
        ok: true,
        valid: false,
        details: { message: 'manifest_signature missing signature or signer_kid' },
      });
    }

    // Optionally compute a manifestSignatureId (dev)
    const manifestSignatureId = process.env.NODE_ENV !== 'production' ? `manifest-sig-dev-${uuidv4()}` : undefined;

    return res.json({
      ok: true,
      valid: true,
      manifestSignatureId,
      details: { note: 'Best-effort validation passed (dev fallback). In production, use Kernel validator.' },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: err?.message || 'Manifest validation failed' } });
  }
});

export default router;

