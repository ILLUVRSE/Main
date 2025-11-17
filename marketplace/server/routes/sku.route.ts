import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * Helper: check operator authorization for admin endpoints.
 * Accepts either:
 *  - Bearer token that equals KERNEL_CONTROL_PANEL_TOKEN env var
 *  - Or a token that contains "operator" (dev convenience)
 */
function isOperatorAuthorized(req: Request) {
  const auth = String(req.header('Authorization') || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return false;

  // prefer explicit control-panel token in env
  const controlToken = process.env.KERNEL_CONTROL_PANEL_TOKEN || '';
  if (controlToken && token === controlToken) return true;

  // dev convenience: tokens containing 'operator' are allowed for local testing
  if (process.env.NODE_ENV !== 'production' && token.toLowerCase().includes('operator')) return true;

  return false;
}

/**
 * GET /sku/:sku_id
 * Returns SKU metadata. Do not return private keys or raw manifests to unauthorized callers.
 */
router.get('/sku/:sku_id', async (req: Request, res: Response) => {
  const skuId = String(req.params.sku_id || '').trim();
  if (!skuId) {
    return res.status(400).json({ ok: false, error: { code: 'MISSING_SKU_ID', message: 'sku_id is required' } });
  }

  // Try DB lookup if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dbMod = require('../lib/db');
    const db = dbMod && (dbMod.default || dbMod);
    if (db && typeof db.query === 'function') {
      const q = `SELECT sku_id, title, summary, price, currency, manifest_metadata, manifest_signature_id, manifest_valid
        FROM skus WHERE sku_id = $1 LIMIT 1`;
      const result = await db.query(q, [skuId]);
      if (result && result.rows && result.rows.length > 0) {
        const r = result.rows[0];
        // Only return metadata and not private manifest unless caller appears authorized
        const callerIsOperator = isOperatorAuthorized(req);
        const manifest = callerIsOperator ? r.manifest_metadata : undefined;

        return res.json({
          ok: true,
          sku: {
            sku_id: r.sku_id,
            title: r.title,
            description: r.summary,
            price: r.price,
            currency: r.currency,
            manifest: manifest ? manifest : { manifest_signature_id: r.manifest_signature_id, manifest_valid: Boolean(r.manifest_valid) },
          },
        });
      }

      return res.status(404).json({ ok: false, error: { code: 'SKU_NOT_FOUND', message: `SKU ${skuId} not found` } });
    }
  } catch (e) {
    // If DB module or query fails, fall through to dev fallback below
    // eslint-disable-next-line no-console
    console.debug('DB not available or error fetching SKU:', (e as Error).message);
  }

  // Dev fallback: return a helpful sample for manual testing in non-prod
  if (process.env.NODE_ENV !== 'production') {
    return res.json({
      ok: true,
      sku: {
        sku_id: skuId,
        title: `Sample SKU ${skuId}`,
        description: 'This is a sample SKU returned by dev fallback.',
        price: 19999,
        currency: 'USD',
        manifest: { manifest_signature_id: 'manifest-sig-dev', manifest_valid: true },
      },
    });
  }

  return res.status(404).json({ ok: false, error: { code: 'SKU_NOT_FOUND', message: `SKU ${skuId} not found` } });
});

/**
 * POST /sku
 * Admin/operator endpoint to register a SKU.
 *
 * Body:
 * {
 *   "manifest": { /* Kernel-signed manifest object */ },
 *   "catalog_metadata": { "categories": ["ml-model"], "visibility": "public", "title": "...", "summary": "...", "price": 19999, "currency":"USD" }
 * }
 */
router.post('/sku', async (req: Request, res: Response) => {
  // Authorization
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: 'Operator authorization required' } });
  }

  const manifest = req.body?.manifest;
  const catalogMetadata = req.body?.catalog_metadata || {};

  if (!manifest || typeof manifest !== 'object') {
    return res.status(400).json({ ok: false, error: { code: 'INVALID_INPUT', message: 'manifest is required' } });
  }

  // Validate manifest with manifestValidator if available
  let manifestSignatureId = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const validatorMod = require('../lib/manifestValidator');
    const validator = validatorMod && (validatorMod.default || validatorMod);
    if (validator && typeof validator.validateManifest === 'function') {
      const validation = await validator.validateManifest(manifest);
      if (!validation || !validation.valid) {
        return res.status(400).json({ ok: false, error: { code: 'INVALID_MANIFEST', message: 'Manifest validation failed', details: validation } });
      }
      // Some validators return a manifestSignatureId
      manifestSignatureId = validation.manifestSignatureId || validation.manifest_signature_id || manifest.manifest_signature?.ts || uuidv4();
    } else {
      // Validator module not implemented, fall back to dev behavior
      if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({ ok: false, error: { code: 'VALIDATOR_MISSING', message: 'Manifest validator not configured' } });
      }
      // Accept manifest in dev and synthesize an id
      manifestSignatureId = uuidv4();
    }
  } catch (err) {
    // If module cannot be required
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ ok: false, error: { code: 'VALIDATOR_ERROR', message: 'Manifest validator error', details: String(err) } });
    }
    manifestSignatureId = uuidv4();
  }

  // Persist SKU to DB if available
  const skuId = catalogMetadata.sku_id || `sku-${uuidv4().slice(0, 8)}`;
  const title = catalogMetadata.title || manifest.title || 'Untitled SKU';
  const summary = catalogMetadata.summary || manifest.description || '';
  const price = Number(catalogMetadata.price || 0);
  const currency = catalogMetadata.currency || 'USD';
  const manifestMetadata = manifest; // store manifest metadata for operators but not return to buyers

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dbMod = require('../lib/db');
    const db = dbMod && (dbMod.default || dbMod);
    if (db && typeof db.query === 'function') {
      const insertSql = `
        INSERT INTO skus (sku_id, title, summary, price, currency, manifest_metadata, manifest_signature_id, manifest_valid, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (sku_id) DO UPDATE
          SET title=EXCLUDED.title, summary=EXCLUDED.summary, price=EXCLUDED.price, currency=EXCLUDED.currency, manifest_metadata=EXCLUDED.manifest_metadata, manifest_signature_id=EXCLUDED.manifest_signature_id, manifest_valid=EXCLUDED.manifest_valid
        RETURNING sku_id, manifest_signature_id
      `;
      const params = [skuId, title, summary, price, currency, manifestMetadata, manifestSignatureId, true];
      const result = await db.query(insertSql, params);
      const row = (result && result.rows && result.rows[0]) || {};
      return res.json({
        ok: true,
        sku_id: row.sku_id || skuId,
        manifestSignatureId: row.manifest_signature_id || manifestSignatureId,
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('DB not available or error inserting SKU:', (e as Error).message);
  }

  // If DB not available, return a dev-friendly response
  return res.json({ ok: true, sku_id: skuId, manifestSignatureId });
});

export default router;

