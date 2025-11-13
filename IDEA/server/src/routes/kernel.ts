// server/src/routes/kernel.ts
import { Router } from 'express';
import axios from 'axios';
import path from 'path';
import fs from 'fs/promises';
import { requireAuth } from '../middleware/auth';
import { verifyKernelCallback } from '../utils/kernel_verify';
import { emitEvent } from '../utils/events';

const router = Router();

// POST /api/v1/kernel/submit
router.post('/kernel/submit', requireAuth(['creator']), async (req:any, res) => {
  const body = req.body ?? {};
  const { artifact_url, sha256, actor_id, metadata, callback_url, profile } = body;
  if (!artifact_url || !sha256 || !actor_id || !metadata) {
    return res.status(400).json({ ok:false, error:{ code:'bad_request', message:'artifact_url, sha256, actor_id, metadata required' }});
  }

  // store submission record
  const id = (callback_url ? (req.headers['idempotency-key'] || `sub_${Date.now()}`) : `sub_${Date.now()}`);
  const submissionsDir = path.resolve(process.cwd(), 'data', 'kernel-submissions');
  await fs.mkdir(submissionsDir, { recursive: true });

  const submission = {
    id,
    artifact_url,
    sha256,
    actor_id,
    metadata,
    callback_url: callback_url ?? null,
    profile: profile ?? 'personal',
    status: 'submitted',
    created_at: new Date().toISOString()
  };
  await fs.writeFile(path.join(submissionsDir, `${id}.json`), JSON.stringify(submission, null, 2), 'utf8');

  // forward to kernel if configured
  if (!process.env.KERNEL_URL) {
    // simulate: return accepted async
    await emitEvent('kernel_submitted', { id, actor_id, artifact_url, sha256 });
    return res.status(202).json({ ok:true, status:'accepted', validation_id: id, message:'Kernel flow not configured; simulated accept' });
  }

  try {
    const kernelAuth = process.env.KERNEL_CLIENT_TOKEN ? { headers: { Authorization: `Bearer ${process.env.KERNEL_CLIENT_TOKEN}` } } : {};
    const response = await axios.post(`${process.env.KERNEL_URL}/sign`, { artifact_url, sha256, actor_id, metadata, callback_url, profile }, kernelAuth);
    if (response.status === 200 && response.data?.manifest) {
      // sync success
      submission.status = 'validated';
      submission.signed_manifest = response.data;
      await fs.writeFile(path.join(submissionsDir, `${id}.json`), JSON.stringify(submission, null, 2), 'utf8');
      await emitEvent('kernel_validated', { id, actor_id, artifact_url, sha256 });
      return res.json({ ok:true, signed_manifest: response.data });
    } else if (response.status === 202) {
      submission.status = 'pending';
      submission.validation_id = response.data?.validation_id ?? id;
      await fs.writeFile(path.join(submissionsDir, `${id}.json`), JSON.stringify(submission, null, 2), 'utf8');
      return res.status(202).json({ ok:true, status:'accepted', validation_id: submission.validation_id, message: 'Kernel will callback' });
    } else {
      return res.status(500).json({ ok:false, error:{ code:'server_error', message:'Unexpected response from kernel' }});
    }
  } catch (err:any) {
    console.error('kernel submit failed', err?.message ?? err);
    return res.status(500).json({ ok:false, error:{ code:'server_error', message:'Failed to contact kernel', details: err?.message }});
  }
});

// POST /api/v1/kernel/callback
router.post('/kernel/callback', async (req:any, res) => {
  try {
    // use raw body buffer for HMAC verification
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body));
    await verifyKernelCallback(raw, req.headers);
  } catch (err:any) {
    return res.status(401).json({ ok:false, error:{ code:'unauthorized', message: err.message }});
  }

  // process the validation payload
  const payload = req.body ?? {};
  const validation_id = payload.validation_id ?? payload.validationId;
  const dir = path.resolve(process.cwd(), 'data', 'kernel-submissions');
  const pathToRec = path.join(dir, `${validation_id}.json`);
  try {
    const recRaw = await fs.readFile(pathToRec, 'utf8');
    const rec = JSON.parse(recRaw);
    rec.kernel_callback = payload;
    rec.status = payload.status === 'PASS' ? 'validated' : 'rejected';
    rec.updated_at = new Date().toISOString();
    await fs.writeFile(pathToRec, JSON.stringify(rec, null, 2), 'utf8');
    await emitEvent('kernel_callback', { validation_id, status: payload.status });
    return res.json({ ok:true, received_at: new Date().toISOString() });
  } catch (e:any) {
    // if submission not found, still store callback for diagnostics
    const cbDir = path.resolve(process.cwd(), 'data', 'kernel-callbacks');
    await fs.mkdir(cbDir, { recursive: true });
    await fs.writeFile(path.join(cbDir, `${validation_id || 'unknown'}.json`), JSON.stringify({ headers: req.headers, body: req.body }, null, 2), 'utf8');
    return res.status(404).json({ ok:false, error:{ code:'not_found', message:'Submission not found; callback recorded' }});
  }
});

export default router;
