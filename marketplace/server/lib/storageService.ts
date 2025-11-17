/**
 * storageService.ts
 *
 * Small abstraction for storing and retrieving binary artifacts.
 * - Default: local filesystem under server/data/storage
 * - Optional: S3-compatible provider if configured in settings.integrations.s3
 *
 * This implementation is intentionally pragmatic for development and tests.
 * When S3 config is present the service will attempt to use @aws-sdk/client-s3.
 * If the AWS SDK is not available at runtime or config is incomplete, the service
 * falls back to local filesystem storage.
 *
 * Public API:
 *  - uploadFileFromPath(localPath, key, opts)
 *  - uploadBuffer(buffer, key, opts)
 *  - streamToResponse(key, res, opts)
 *  - getDownloadUrl(key, opts)
 *  - deleteObject(key, opts)
 *  - exists(key)
 */

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import logger from './logger';
import settingsService from './settingsService';
import auditWriter from './auditWriter';

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORAGE_DIR = path.join(DATA_DIR, 'storage');

async function ensureStorageDir() {
  try {
    await fs.promises.mkdir(STORAGE_DIR, { recursive: true });
  } catch (err) {
    logger.warn('storage.ensureDir.failed', { err });
  }
}

/**
 * Return a safe absolute path for a given key under storage root.
 * Keys like "uploads/abc.png" are mapped to storage/uploads/abc.png
 */
function localPathForKey(key: string) {
  // Prevent path traversal
  const safe = key.replace(/\.\.+/g, '').replace(/^\/+/, '');
  return path.join(STORAGE_DIR, safe);
}

/**
 * Attempt to initialize an S3 client if settings indicate.
 * Returns an object { client, bucket, configured } or { configured: false }.
 * This function is best-effort: it won't throw if AWS SDK is not installed.
 */
async function tryCreateS3Client() {
  try {
    const cfg: any = (await settingsService.get('integrations.s3')) || (await settingsService.get('s3')) || null;
    if (!cfg || !cfg.bucket) {
      return { configured: false };
    }

    // Lazy import to avoid hard dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
      region: cfg.region || 'us-east-1',
      endpoint: cfg.endpoint || undefined,
      credentials: cfg.accessKeyId
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined,
      forcePathStyle: cfg.forcePathStyle || false,
    });

    return {
      configured: true,
      client,
      bucket: cfg.bucket,
      commands: { PutObjectCommand, GetObjectCommand, DeleteObjectCommand },
      cfg,
    };
  } catch (err) {
    // If require fails (no SDK) or config invalid, fall back to local FS
    logger.warn('storage.s3.init_failed', { err });
    return { configured: false };
  }
}

/**
 * Upload a file from local filesystem to storage key.
 * If S3 configured, upload to S3; otherwise copy to local storage.
 */
export async function uploadFileFromPath(localPath: string, key: string, opts: { contentType?: string; metadata?: Record<string, any> } = {}) {
  try {
    const s3 = await tryCreateS3Client();
    if (s3.configured) {
      const { client, bucket, commands } = s3 as any;
      const body = await fs.promises.readFile(localPath);
      await client.send(new commands.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        Metadata: opts.metadata,
      }));
      await auditWriter.write({ actor: 'system', action: 'storage.upload.s3', details: { key, bucket } });
      return true;
    }

    // Local filesystem fallback
    await ensureStorageDir();
    const dest = localPathForKey(key);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(localPath, dest);
    await auditWriter.write({ actor: 'system', action: 'storage.upload.local', details: { key, path: dest } });
    return true;
  } catch (err) {
    logger.error('storage.uploadFileFromPath.failed', { err, key, localPath });
    return false;
  }
}

/**
 * Upload a buffer to storage key.
 */
export async function uploadBuffer(buffer: Buffer, key: string, opts: { contentType?: string; metadata?: Record<string, any> } = {}) {
  try {
    const s3 = await tryCreateS3Client();
    if (s3.configured) {
      const { client, bucket, commands } = s3 as any;
      await client.send(new commands.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: opts.contentType,
        Metadata: opts.metadata,
      }));
      await auditWriter.write({ actor: 'system', action: 'storage.upload.s3', details: { key, bucket } });
      return true;
    }

    await ensureStorageDir();
    const dest = localPathForKey(key);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, buffer);
    await auditWriter.write({ actor: 'system', action: 'storage.upload.local', details: { key, path: dest } });
    return true;
  } catch (err) {
    logger.error('storage.uploadBuffer.failed', { err, key });
    return false;
  }
}

/**
 * Stream object to an express response. If S3 configured will stream from S3, otherwise from local Fs.
 */
export async function streamToResponse(key: string, res: any, opts: { range?: string | undefined } = {}) {
  try {
    const s3 = await tryCreateS3Client();
    if (s3.configured) {
      const { client, bucket, commands } = s3 as any;
      const getCmd = new commands.GetObjectCommand({ Bucket: bucket, Key: key, Range: opts.range });
      const resp: any = await client.send(getCmd);
      // resp.Body is a stream in AWS SDK v3
      if (resp.Body && typeof resp.Body.pipe === 'function') {
        if (resp.ContentType) res.setHeader('Content-Type', resp.ContentType);
        if (resp.ContentLength) res.setHeader('Content-Length', String(resp.ContentLength));
        if (resp.ContentDisposition) res.setHeader('Content-Disposition', resp.ContentDisposition);
        const bodyStream = resp.Body as Readable;
        bodyStream.pipe(res);
        return true;
      } else {
        logger.error('storage.s3.getobject.nostream', { key });
        return false;
      }
    }

    // Local filesystem fallback
    const p = localPathForKey(key);
    if (!fs.existsSync(p)) {
      return false;
    }

    const stat = await fs.promises.stat(p);
    res.setHeader('Content-Length', String(stat.size));
    const ext = path.extname(p).toLowerCase();
    // Minimal content type mapping
    if (ext === '.zip') res.setHeader('Content-Type', 'application/zip');
    else if (ext === '.png') res.setHeader('Content-Type', 'image/png');
    else if (ext === '.jpg' || ext === '.jpeg') res.setHeader('Content-Type', 'image/jpeg');
    else if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
    else res.setHeader('Content-Type', 'application/octet-stream');

    const stream = fs.createReadStream(p);
    stream.pipe(res);
    return true;
  } catch (err) {
    logger.error('storage.streamToResponse.failed', { err, key });
    return false;
  }
}

/**
 * Get a download URL for a key. For local storage this is a filesystem path (not suitable for browser).
 * If S3 with bucket and region is configured and a signer is available, produce a presigned URL.
 * This method is best-effort and may return null if not possible.
 */
export async function getDownloadUrl(key: string, opts: { expiresSeconds?: number } = {}) {
  try {
    const s3 = await tryCreateS3Client();
    if (s3.configured) {
      try {
        // Try to use @aws-sdk/s3-request-presigner if available
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const { client, bucket, commands } = s3 as any;
        const cmd = new commands.GetObjectCommand({ Bucket: bucket, Key: key });
        const url = await getSignedUrl(client, cmd, { expiresIn: Number(opts.expiresSeconds ?? 300) });
        return url;
      } catch (err) {
        logger.warn('storage.s3.presign_failed', { err });
        return null;
      }
    }

    // Local fallback: return file:// path if exists
    const p = localPathForKey(key);
    if (fs.existsSync(p)) {
      return `file://${p}`;
    }
    return null;
  } catch (err) {
    logger.error('storage.getDownloadUrl.failed', { err, key });
    return null;
  }
}

/**
 * Delete object by key.
 */
export async function deleteObject(key: string) {
  try {
    const s3 = await tryCreateS3Client();
    if (s3.configured) {
      const { client, bucket, commands } = s3 as any;
      await client.send(new commands.DeleteObjectCommand({ Bucket: bucket, Key: key }));
      await auditWriter.write({ actor: 'system', action: 'storage.delete.s3', details: { key, bucket } });
      return true;
    }

    const p = localPathForKey(key);
    if (fs.existsSync(p)) {
      await fs.promises.unlink(p);
      await auditWriter.write({ actor: 'system', action: 'storage.delete.local', details: { key, path: p } });
      return true;
    }
    return false;
  } catch (err) {
    logger.error('storage.deleteObject.failed', { err, key });
    return false;
  }
}

/**
 * Check if an object exists.
 */
export async function exists(key: string) {
  try {
    const s3 = await tryCreateS3Client();
    if (s3.configured) {
      const { client, bucket, commands } = s3 as any;
      try {
        await client.send(new commands.GetObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    }

    const p = localPathForKey(key);
    return fs.existsSync(p);
  } catch (err) {
    logger.error('storage.exists.failed', { err, key });
    return false;
  }
}

export default {
  uploadFileFromPath,
  uploadBuffer,
  streamToResponse,
  getDownloadUrl,
  deleteObject,
  exists,
};

