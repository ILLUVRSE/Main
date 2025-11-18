/**
 * marketplace/server/tools/auditExporter.ts
 *
 * Export an array of audit events to an S3-compatible bucket for immutable archival.
 *
 * - Uses AWS SDK v3 S3Client to write a JSON file containing the audit batch.
 * - Adds metadata and server-side-encryption headers.
 * - Optionally sets object lock headers when the bucket supports Object Lock.
 *
 * Environment-driven S3 config:
 * - S3_ENDPOINT (optional) e.g. http://127.0.0.1:9000
 * - S3_REGION (optional) default 'us-east-1'
 * - S3_ACCESS_KEY_ID
 * - S3_SECRET_ACCESS_KEY
 * - S3_FORCE_PATH_STYLE (optional, 'true' to use path-style addressing for MinIO)
 *
 * Usage:
 *   import { exportAuditBatch } from './tools/auditExporter';
 *   await exportAuditBatch(auditRows, {
 *     bucket: 'marketplace-audit',
 *     prefix: 'exports/2025-11-17',
 *     objectLockRetainDays: 365, // optional
 *   });
 *
 * Note about Object Lock:
 * - Enabling Object Lock requires special bucket configuration at create time
 *   and cannot be retroactively enabled on an existing bucket.
 * - This exporter will set Object Lock headers when provided (ObjectLockMode + RetainUntilDate),
 *   but the bucket *must* already support Object Lock. If the bucket doesn't support it,
 *   the upload will still succeed without object lock headers (S3 will ignore them).
 */

import { S3Client, PutObjectCommand, HeadObjectCommand, PutObjectCommandInput } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

type AuditEvent = {
  id?: number | string;
  actor_id?: string;
  event_type?: string;
  payload?: any;
  hash?: string;
  prev_hash?: string | null;
  signature?: string | null;
  signer_kid?: string | null;
  created_at?: string;
  [k: string]: any;
};

export type ExportOptions = {
  bucket: string;
  prefix?: string; // optional prefix path inside bucket
  filename?: string; // default: audit-export-<ts>.json
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
  objectLockRetainDays?: number; // optional number of days to set RetainUntilDate
  objectLockMode?: 'GOVERNANCE' | 'COMPLIANCE';
  serverSideEncryption?: 'AES256' | 'aws:kms';
  contentType?: string;
};

function defaultString(v?: string, d = ''): string {
  return typeof v === 'string' ? v : d;
}

function buildS3Client(opts: ExportOptions): S3Client {
  const region = opts.s3Region || defaultString(process.env.S3_REGION, process.env.S3_REGION || 'us-east-1');
  const endpoint = opts.s3Endpoint || process.env.S3_ENDPOINT;
  const accessKeyId = opts.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = opts.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY;
  const forcePathStyle = opts.s3ForcePathStyle ?? (process.env.S3_FORCE_PATH_STYLE === 'true');

  const clientConfig: any = { region };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
    };
  }

  if (forcePathStyle) {
    clientConfig.forcePathStyle = true;
  }

  return new S3Client(clientConfig);
}

/**
 * Export audit batch to S3.
 * Returns the S3 key (path) of the uploaded file and the location URL.
 */
export async function exportAuditBatch(auditEvents: AuditEvent[], opts: ExportOptions) {
  if (!Array.isArray(auditEvents)) throw new Error('auditEvents must be an array');

  const client = buildS3Client(opts);

  const bucket = opts.bucket;
  if (!bucket) throw new Error('bucket is required in options');

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = opts.filename || `audit-export-${ts}.json`;
  const prefix = opts.prefix ? `${opts.prefix.replace(/\/$/, '')}/` : '';
  const key = `${prefix}${filename}`;

  // Build payload: envelope with metadata and events
  const envelope = {
    exported_at: new Date().toISOString(),
    count: auditEvents.length,
    events: auditEvents,
  };

  const bodyStr = JSON.stringify(envelope, null, 2);

  // Prepare put params
  const putParams: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    Body: bodyStr,
    ContentType: opts.contentType || 'application/json; charset=utf-8',
    Metadata: {
      exported_by: 'illuvrse-audit-exporter',
      exported_at: new Date().toISOString(),
      events_count: String(auditEvents.length),
    },
  };

  // server-side encryption
  if (opts.serverSideEncryption) {
    putParams.ServerSideEncryption = opts.serverSideEncryption as any;
  }

  // Object lock (if requested)
  if (opts.objectLockRetainDays && opts.objectLockRetainDays > 0) {
    // S3 expects ISO date for RetainUntilDate, and ObjectLockMode
    const until = new Date();
    until.setUTCDate(until.getUTCDate() + opts.objectLockRetainDays);
    putParams.ObjectLockMode = opts.objectLockMode || 'GOVERNANCE';
    putParams.ObjectLockRetainUntilDate = until;
    // Note: PutObject will fail if the bucket doesn't support object lock.
  }

  // Upload
  try {
    await client.send(new PutObjectCommand(putParams));
  } catch (err: any) {
    // If ObjectLock headers caused failure, try again without them (best-effort).
    if (opts.objectLockRetainDays && (err?.name === 'InvalidArgument' || String(err?.message).includes('ObjectLock'))) {
      // remove object lock params and retry
      delete putParams.ObjectLockMode;
      delete putParams.ObjectLockRetainUntilDate;
      await client.send(new PutObjectCommand(putParams));
    } else {
      throw err;
    }
  }

  // Try to fetch head to confirm and return metadata
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const location = opts.s3Endpoint
      ? `${opts.s3Endpoint.replace(/\/$/, '')}/${bucket}/${key}`
      : `s3://${bucket}/${key}`;
    return {
      bucket,
      key,
      location,
      metadata: head.Metadata,
      etag: head.ETag,
      contentLength: head.ContentLength,
      objectLockMode: head.ObjectLockMode,
      objectLockRetainUntilDate: head.ObjectLockRetainUntilDate,
    };
  } catch (err) {
    // upload succeeded but head failed (odd). Return best-effort
    const location = opts.s3Endpoint
      ? `${opts.s3Endpoint.replace(/\/$/, '')}/${bucket}/${key}`
      : `s3://${bucket}/${key}`;
    return { bucket, key, location };
  }
}

/* Convenience default export */
export default exportAuditBatch;

