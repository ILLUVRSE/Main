import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../lib/logger';
import auditWriter from '../lib/auditWriter';
import marketplaceService from '../lib/marketplaceService';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// Where uploaded files are stored on disk
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
const UPLOADS_META = path.join(__dirname, '..', 'data', 'uploads.json');

async function ensureUploadsDir() {
  try {
    await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
  } catch (err) {
    logger.warn('uploads.ensureDir.failed', { err });
  }
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file, { encoding: 'utf-8' });
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: any) {
  try {
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
    await fs.promises.rename(tmp, file);
  } catch (err) {
    logger.error('uploads.writeJsonFile.failed', { err, file });
    throw err;
  }
}

interface UploadRecord {
  id: string;
  name: string;
  filenameOnDisk?: string; // actual disk filename (absolute)
  url?: string; // optional external URL if uploaded to external provider
  size?: number;
  mimetype?: string;
  metadata?: Record<string, any>;
  uploadedBy?: string;
  createdAt: string;
}

/**
 * Multer storage configuration: store files under UPLOADS_DIR.
 */
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureUploadsDir();
      cb(null, UPLOADS_DIR);
    } catch (err) {
      cb(err as any, UPLOADS_DIR);
    }
  },
  filename: (_req, file, cb) => {
    // Prefix with timestamp + uuid for uniqueness
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, '_');
    const name = `${Date.now()}-${uuidv4().slice(0, 8)}-${safe}`;
    cb(null, name);
  },
});

const upload = multer({ storage });

/**
 * Helper: persist upload metadata
 */
async function loadUploads(): Promise<UploadRecord[]> {
  return await readJsonFile<UploadRecord[]>(UPLOADS_META, []);
}

async function saveUploads(items: UploadRecord[]) {
  await ensureUploadsDir();
  await writeJsonFile(UPLOADS_META, items);
}

/**
 * POST /uploads
 * Upload a single file (field name: 'file') or multiple using 'files[]'.
 * Requires authentication.
 */
router.post('/', requireAuth, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'no file uploaded (field "file")' });
    }

    const now = new Date().toISOString();
    const id = uuidv4();
    const rec: UploadRecord = {
      id,
      name: req.file.originalname,
      filenameOnDisk: path.resolve(req.file.path),
      size: req.file.size,
      mimetype: req.file.mimetype,
      metadata: req.body?.metadata ? (typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata) : {},
      uploadedBy: user.id,
      createdAt: now,
    };

    const items = await loadUploads();
    items.push(rec);
    await saveUploads(items);

    await auditWriter.write({
      actor: user.id,
      action: 'upload.create',
      details: { uploadId: id, filename: rec.name, size: rec.size },
    });

    res.status(201).json({ ok: true, upload: rec });
  } catch (err) {
    logger.error('uploads.create.failed', { err });
    next(err);
  }
});

/**
 * POST /uploads/multiple
 * Upload multiple files using field 'files'
 */
router.post('/multiple', requireAuth, upload.array('files', 20), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ ok: false, error: 'no files uploaded' });

    const now = new Date().toISOString();
    const items = await loadUploads();
    const created: UploadRecord[] = [];

    for (const f of files) {
      const id = uuidv4();
      const rec: UploadRecord = {
        id,
        name: f.originalname,
        filenameOnDisk: path.resolve(f.path),
        size: f.size,
        mimetype: f.mimetype,
        metadata: {},
        uploadedBy: user.id,
        createdAt: now,
      };
      items.push(rec);
      created.push(rec);
      await auditWriter.write({
        actor: user.id,
        action: 'upload.create',
        details: { uploadId: id, filename: rec.name, size: rec.size },
      });
    }

    await saveUploads(items);

    res.status(201).json({ ok: true, uploads: created });
  } catch (err) {
    logger.error('uploads.multiple.failed', { err });
    next(err);
  }
});

/**
 * GET /uploads/:id
 * Return metadata for an upload
 */
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const items = await loadUploads();
    const rec = items.find((r) => r.id === id);
    if (!rec) return res.status(404).json({ ok: false, error: 'upload not found' });
    res.json({ ok: true, upload: rec });
  } catch (err) {
    logger.error('uploads.get.failed', { err });
    next(err);
  }
});

/**
 * Helper: try to find listing that references this file id (if any)
 */
async function findListingByFileId(fileId: string) {
  try {
    // marketplaceService stores files inside listings; iterate to find reference
    const all = await (marketplaceService as any).listListings({ page: 1, limit: 10000 });
    const items = all.items || [];
    for (const l of items) {
      const files = l.files || [];
      if (files.some((f: any) => f.id === fileId)) return l;
    }
    return null;
  } catch (err) {
    logger.warn('uploads.findListingByFileId.failed', { err, fileId });
    return null;
  }
}

/**
 * GET /uploads/:id/download
 * Stream or redirect the uploaded file. Only uploader or admin or owner of listing referencing file may download.
 */
router.get('/:id/download', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    const items = await loadUploads();
    const rec = items.find((r) => r.id === id);
    if (!rec) return res.status(404).json({ ok: false, error: 'upload not found' });

    // Authorization: uploader or admin or listing owner
    const isUploader = rec.uploadedBy === user.id;
    const isAdmin = (user.roles || []).includes('admin');

    let listing = null;
    try {
      listing = await findListingByFileId(id);
    } catch {
      listing = null;
    }
    const isListingOwner = listing && listing.authorId === user.id;

    if (!isUploader && !isAdmin && !isListingOwner) {
      return res.status(403).json({ ok: false, error: 'not authorized to download' });
    }

    // If external url is present, redirect
    if (rec.url) {
      await auditWriter.write({
        actor: user.id,
        action: 'upload.download.redirect',
        details: { uploadId: id, url: rec.url },
      });
      return res.redirect(rec.url);
    }

    if (rec.filenameOnDisk && fs.existsSync(rec.filenameOnDisk)) {
      await auditWriter.write({
        actor: user.id,
        action: 'upload.download',
        details: { uploadId: id, filename: rec.name },
      });
      return res.download(rec.filenameOnDisk, rec.name, (err) => {
        if (err) {
          logger.error('uploads.download.failed', { err, uploadId: id });
        }
      });
    }

    return res.status(404).json({ ok: false, error: 'file missing' });
  } catch (err) {
    logger.error('uploads.download.failed', { err });
    next(err);
  }
});

/**
 * DELETE /uploads/:id
 * Remove an upload record and file from disk. Only uploader or admin can delete.
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    const items = await loadUploads();
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'upload not found' });

    const rec = items[idx];
    const isUploader = rec.uploadedBy === user.id;
    const isAdmin = (user.roles || []).includes('admin');
    if (!isUploader && !isAdmin) {
      return res.status(403).json({ ok: false, error: 'not authorized' });
    }

    // Remove file on disk if exists
    if (rec.filenameOnDisk && fs.existsSync(rec.filenameOnDisk)) {
      try {
        await fs.promises.unlink(rec.filenameOnDisk);
      } catch (err) {
        logger.warn('uploads.delete.unlink_failed', { err, path: rec.filenameOnDisk });
      }
    }

    items.splice(idx, 1);
    await saveUploads(items);

    await auditWriter.write({
      actor: user.id,
      action: 'upload.delete',
      details: { uploadId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('uploads.delete.failed', { err });
    next(err);
  }
});

export default router;

