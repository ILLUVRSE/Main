// server/src/routes/package.ts
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { sha256FromFile } from '../utils/hash.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/v1/package
router.post('/package', requireAuth(['creator']), async (req:any, res) => {
  const artifact_id = uuidv4();
  const baseDir = path.resolve(process.cwd(), 'data', 'artifacts');
  const metaPath = path.join(baseDir, `${artifact_id}.json`);
  await fs.mkdir(baseDir, { recursive: true });

  const meta = {
    artifact_id,
    created_by: req.user?.sub ?? 'unknown',
    created_at: new Date().toISOString(),
    notes: req.body?.notes ?? null
  };
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  if (process.env.S3_UPLOAD === '1') {
    // Placeholder: real presign code would go here
    return res.json({
      ok: true,
      artifact_id,
      upload_url: 'https://s3.example/presigned-url',
      artifact_put_method: 'PUT',
      artifact_max_size: 200 * 1024 * 1024
    });
  } else {
    const upload_url = `${process.env.BASE_URL ?? 'http://127.0.0.1:5175'}/api/v1/package/upload/${artifact_id}`;
    return res.json({
      ok: true,
      artifact_id,
      upload_url,
      artifact_put_method: 'PUT',
      artifact_max_size: 200 * 1024 * 1024,
      expected_sha256: ''
    });
  }
});

// PUT /api/v1/package/upload/:artifact_id
// Accepts raw binary upload (dev fallback)
router.put('/package/upload/:artifact_id', requireAuth(['creator']), async (req:any, res) => {
  const id = req.params.artifact_id;
  const outDir = path.resolve(process.cwd(), 'data', 'artifacts', 'files');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${id}.tgz`);

  const ws = fsSync.createWriteStream(outPath);
  req.pipe(ws);
  req.on('end', async () => {
    const size = (await fs.stat(outPath)).size;
    return res.json({ ok: true, artifact_id: id, path: outPath, size_bytes: size });
  });
  req.on('error', (err:any) => {
    console.error('upload error', err);
    return res.status(500).json({ ok:false, error:{ code:'server_error', message:'upload failed' }});
  });
});

// POST /api/v1/package/complete
router.post('/package/complete', requireAuth(['creator']), async (req:any, res) => {
  const { artifact_id, sha256 } = req.body ?? {};
  if (!artifact_id || !sha256) {
    return res.status(400).json({ ok:false, error:{ code:'bad_request', message:'artifact_id and sha256 required' }});
  }
  const filePath = path.resolve(process.cwd(), 'data', 'artifacts', 'files', `${artifact_id}.tgz`);
  try {
    // ensure file exists
    await fs.access(filePath);
  } catch (e) {
    return res.status(404).json({ ok:false, error:{ code:'not_found', message:'artifact file not found' }});
  }

  const actual = await sha256FromFile(filePath);
  if (actual !== sha256) {
    return res.status(409).json({ ok:false, error:{ code:'conflict', message:'sha256 mismatch', details:{ expected: sha256, actual } }});
  }

  const metaPath = path.resolve(process.cwd(), 'data', 'artifacts', `${artifact_id}.json`);
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8') || '{}');
  meta.sha256 = sha256;
  meta.artifact_url = `file://${filePath}`;
  meta.size_bytes = (await fs.stat(filePath)).size;
  meta.completed_at = new Date().toISOString();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  return res.json({ ok:true, artifact_id, artifact_url: meta.artifact_url, sha256 });
});

export default router;

