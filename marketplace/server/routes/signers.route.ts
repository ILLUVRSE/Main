/**
 * marketplace/server/routes/admin/signers.route.ts
 *
 * Admin routes to manage signer registry.
 *
 * Routes:
 *  GET    /admin/signers            -> { ok:true, signers: [...] }
 *  POST   /admin/signers            -> { ok:true, signer: {...} }
 *  DELETE /admin/signers/:signer_kid -> { ok:true, removed: true|false }
 *
 * Operator authorization is required. For dev convenience the route accepts:
 *  - Authorization: Bearer <KERNEL_CONTROL_PANEL_TOKEN>
 *  - Or, when NODE_ENV !== 'production', tokens containing "operator".
 *
 * This relies on `server/lib/signerRegistry` for persistence.
 */

import { Router, Request, Response } from 'express';
import signerRegistry from '../../lib/signerRegistry';

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

/* GET /admin/signers */
router.get('/admin/signers', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  try {
    const signers = await signerRegistry.listSigners();
    return res.json({ ok: true, signers });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('GET /admin/signers failed:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to list signers', details: String(err) } });
  }
});

/* POST /admin/signers */
router.post('/admin/signers', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  const body = req.body || {};
  const signer_kid = (body.signer_kid || '').toString().trim();
  const public_key_pem = body.public_key_pem ? String(body.public_key_pem) : null;
  const comment = body.comment ? String(body.comment) : null;

  if (!signer_kid) {
    return res.status(400).json({ ok: false, error: { message: 'signer_kid is required' } });
  }

  try {
    const entry = await signerRegistry.addSigner({
      signer_kid,
      public_key_pem,
      comment,
    });
    return res.json({ ok: true, signer: entry });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('POST /admin/signers failed:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to add signer', details: String(err) } });
  }
});

/* DELETE /admin/signers/:signer_kid */
router.delete('/admin/signers/:signer_kid', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  const signer_kid = String(req.params.signer_kid || '').trim();
  if (!signer_kid) {
    return res.status(400).json({ ok: false, error: { message: 'signer_kid required' } });
  }

  try {
    const removed = await signerRegistry.removeSigner(signer_kid);
    return res.json({ ok: true, removed });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('DELETE /admin/signers/:signer_kid failed:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to remove signer', details: String(err) } });
  }
});

export default router;

