/**
 * memory-layer/service/audit/archiver.ts
 *
 * Simple archival job: exports audit_events rows (in JSON) to an S3 audit-archive bucket
 * configured with Object Lock (COMPLIANCE). Intended for nightly runs / DR drills.
 *
 * Behavior:
 *  - Exports a contiguous batch of audit_events (by created_at ASC) into a single JSON object.
 *  - Writes to S3 at key: <prefix>/<env>-audit-YYYYMMDDTHHMMSS-<uuid>.json
 *  - Optionally sets object legal-hold or retention via PutObjectLegalHold / PutObjectRetention.
 *  - Emits a small manifest entry with sha256 of the exported payload so verifyTool can pick it up.
 *
 * Usage (CLI):
 *   AUDIT_ARCHIVE_BUCKET=illuvrse-audit-archive-dev \
 *   AWS_REGION=us-east-1 \
 *   DATABASE_URL=... \
 *   npx ts-node memory-layer/service/audit/archiver.ts --limit=1000
 *
 * Environment:
 *  - AUDIT_ARCHIVE_BUCKET        (required)
 *  - AUDIT_ARCHIVE_PREFIX        (optional, default "archives")
 *  - AUDIT_ARCHIVE_RETENTION_DAYS (optional, default 400)
 *  - AUDIT_ARCHIVE_LEGAL_HOLD    (optional, "true" -> set legal hold)
 *  - AWS_REGION / AWS_DEFAULT_REGION
 *
 * Notes:
 *  - This file uses @aws-sdk/client-s3 (v3).
 *  - Requires S3 bucket already created with Object Lock enabled (COMPLIANCE).
 *  - For production configure cross-region replication and KMS encryption on the bucket.
 */

import { S3Client, PutObjectCommand, PutObjectLegalHoldCommand, PutObjectRetentionCommand } from '@aws-sdk/client-s3';
import { Client } from 'pg';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { resolve } from 'path';
import fs from 'fs';

const argv = process.argv.slice(2);

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function getDbClient(): Promise<Client> {
  const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connStr) throw new Error('DATABASE_URL or POSTGRES_URL is required');
  const c = new Client({ connectionString: connStr });
  await c.connect();
  return c;
}

function s3Client(): S3Client {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  return new S3Client({ region });
}

function nowIso(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sha256Hex(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Fetch a batch of audit_events ordered by created_at asc.
 * If afterId provided, starts after that id (exclusive).
 */
async function fetchAuditBatch(client: Client, limit = 1000, afterId?: string) {
  if (afterId) {
    const q = await client.query(
      `
      SELECT id, event_type, memory_node_id, artifact_id, payload, hash, prev_hash, signature, manifest_signature_id, created_at
      FROM audit_events
      WHERE created_at > (SELECT created_at FROM audit_events WHERE id = $1)
      ORDER BY created_at ASC
      LIMIT $2
    `,
      [afterId, limit]
    );
    return q.rows;
  } else {
    const q = await client.query(
      `
      SELECT id, event_type, memory_node_id, artifact_id, payload, hash, prev_hash, signature, manifest_signature_id, created_at
      FROM audit_events
      ORDER BY created_at ASC
      LIMIT $1
    `,
      [limit]
    );
    return q.rows;
  }
}

/**
 * Upload JSON payload to S3 and optionally set legal hold / retention.
 */
async function uploadToS3(key: string, body: Buffer, opts: { bucket: string; legalHold?: boolean; retentionDays?: number }) {
  const client = s3Client();

  // Put object with SSE-KMS if bucket configured to use KMS (the bucket should have its own policy)
  const putCmd = new PutObjectCommand({
    Bucket: opts.bucket,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    ContentLength: body.length
    // ServerSideEncryption or SSEKMSKeyId intentionally left to bucket config / operator.
  });

  await client.send(putCmd);

  // Set legal hold if requested
  if (opts.legalHold) {
    const legalCmd = new PutObjectLegalHoldCommand({
      Bucket: opts.bucket,
      Key: key,
      LegalHold: { Status: 'ON' }
    });
    await client.send(legalCmd);
  }

  // Set retention if requested
  if (typeof opts.retentionDays === 'number' && opts.retentionDays > 0) {
    const until = new Date();
    until.setDate(until.getDate() + opts.retentionDays);
    const retentionCmd = new PutObjectRetentionCommand({
      Bucket: opts.bucket,
      Key: key,
      Retention: {
        Mode: 'COMPLIANCE',
        RetainUntilDate: until.toISOString()
      }
    });
    await client.send(retentionCmd);
  }
}

/**
 * Main export function: fetches batch, writes JSON to S3, and writes a small manifest file locally.
 */
export async function exportAuditBatchToS3(params: {
  limit?: number;
  afterId?: string | undefined;
  dryRun?: boolean;
  outDir?: string | undefined;
}) {
  const bucket = process.env.AUDIT_ARCHIVE_BUCKET;
  if (!bucket) {
    throw new Error('AUDIT_ARCHIVE_BUCKET env required');
  }
  const prefix = process.env.AUDIT_ARCHIVE_PREFIX ?? 'archives';
  const retentionDays = Number(process.env.AUDIT_ARCHIVE_RETENTION_DAYS ?? '400');
  const legalHold = String(process.env.AUDIT_ARCHIVE_LEGAL_HOLD ?? 'false').toLowerCase() === 'true';

  const limit = params.limit ?? Number(parseArg('limit') || 1000);
  const afterId = params.afterId ?? parseArg('afterId') ?? undefined;
  const dryRun = params.dryRun ?? Boolean(parseArg('dryRun'));
  const outDir = params.outDir ?? process.env.AUDIT_ARCHIVE_OUTDIR ?? undefined;

  const db = await getDbClient();
  try {
    const rows = await fetchAuditBatch(db, limit, afterId);
    if (!rows.length) {
      console.log(`no audit_events to export (limit=${limit}, afterId=${afterId ?? 'none'})`);
      return { exported: 0 };
    }

    const payloadObj = {
      exportedAt: new Date().toISOString(),
      count: rows.length,
      events: rows
    };

    const bodyStr = JSON.stringify(payloadObj, null, 2);
    const bodyBuf = Buffer.from(bodyStr, 'utf8');
    const digest = sha256Hex(bodyBuf);

    const ts = nowIso();
    const filename = `${ts}-${uuidv4()}.json`;
    const key = `${prefix}/${process.env.NODE_ENV ?? 'dev'}-audit-${filename}`;
    console.log(`prepared archive: key=${key} size=${bodyBuf.length} sha256=${digest}`);

    if (dryRun) {
      console.log('dryRun: not uploading to S3. Exiting.');
      if (outDir) {
        const outPath = resolve(outDir, filename);
        fs.writeFileSync(outPath, bodyStr, 'utf8');
        console.log(`wrote local copy to ${outPath}`);
      }
      return { exported: rows.length, key, sha256: digest };
    }

    // upload to S3
    await uploadToS3(key, bodyBuf, { bucket, legalHold, retentionDays });
    console.log(`uploaded archive to s3://${bucket}/${key}`);

    // Optionally write a small manifest locally for operators
    if (outDir) {
      const manifest = {
        key,
        bucket,
        sha256: digest,
        createdAt: new Date().toISOString(),
        count: rows.length
      };
      const manifestPath = resolve(outDir, `${filename}.manifest.json`);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log(`wrote manifest to ${manifestPath}`);
    }

    return { exported: rows.length, key, sha256: digest };
  } finally {
    await db.end();
  }
}

/**
 * CLI entrypoint
 */
if (require.main === module) {
  (async () => {
    try {
      const limitArg = parseArg('limit');
      const afterId = parseArg('afterId');
      const dryRunArg = parseArg('dryRun');
      const outDirArg = parseArg('outDir');
      const res = await exportAuditBatchToS3({
        limit: limitArg ? Number(limitArg) : undefined,
        afterId: afterId ?? undefined,
        dryRun: dryRunArg === 'true',
        outDir: outDirArg
      });
      console.log('archive result:', res);
      process.exit(0);
    } catch (err) {
      console.error('archive failed:', (err as Error).message || err);
      process.exit(2);
    }
  })();
}

export default {
  exportAuditBatchToS3
};

