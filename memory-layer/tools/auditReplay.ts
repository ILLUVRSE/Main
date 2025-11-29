/**
 * memory-layer/tools/auditReplay.ts
 *
 * Replay audit export (JSON) from S3 or local file into a Postgres DB.
 *
 * Usage:
 *  DATABASE_URL=... npx ts-node memory-layer/tools/auditReplay.ts --from-s3=s3://bucket/key
 *  DATABASE_URL=... npx ts-node memory-layer/tools/auditReplay.ts --from-file=./audit-export.json
 *
 * Options:
 *  --from-s3= s3://bucket/key    (mutually exclusive with --from-file)
 *  --from-file= local path
 *  --limit=N                      only process first N events
 *  --force                        ignore prev_hash mismatch and insert anyway (use with care)
 *  --dry-run                      validate chain/signatures but do not insert
 *
 * Expected input format: JSON array of audit event objects with fields:
 *   { id?, event_type, memory_node_id, artifact_id, payload, hash, prev_hash, signature, manifest_signature_id, created_at? }
 *
 * Behavior:
 *  - Verifies computed digest matches stored `hash`.
 *  - Optionally verifies signature using KMS adapter.
 *  - Ensures prev_hash matches current db head (unless --force).
 *  - Inserts events (in order) using `INSERT ... ON CONFLICT (hash) DO NOTHING`.
 *
 * Note: This tool is for DR replays into staging. Use --force carefully for import into a live chain.
 */

import fs from 'fs';
import { URL } from 'url';
import { Client } from 'pg';
import { S3 } from 'aws-sdk';
import auditChain, { canonicalizePayload, computeAuditDigest } from '../service/audit/auditChain';

type InputEvent = {
  id?: string;
  event_type: string;
  memory_node_id?: string | null;
  artifact_id?: string | null;
  payload: any;
  hash: string;
  prev_hash?: string | null;
  signature?: string | null;
  manifest_signature_id?: string | null;
  created_at?: string | null;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((a) => a === `--${name}`);
}

async function fetchFromS3(s3url: string): Promise<string> {
  if (!s3url.startsWith('s3://')) throw new Error('from-s3 must be an s3:// URL');
  const without = s3url.slice('s3://'.length);
  const slash = without.indexOf('/');
  if (slash <= 0) throw new Error('invalid s3 url (expected s3://bucket/key)');
  const bucket = without.slice(0, slash);
  const key = without.slice(slash + 1);

  const s3 = new S3({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
    s3ForcePathStyle: String(process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY
  });

  const resp = await s3.getObject({ Bucket: bucket, Key: key }).promise();
  if (!resp.Body) throw new Error('empty object from s3');
  if (Buffer.isBuffer(resp.Body)) return resp.Body.toString('utf8');
  if (typeof resp.Body === 'string') return resp.Body;
  // stream case
  return (resp.Body as any).toString('utf8');
}

async function readInput(): Promise<InputEvent[]> {
  const fromFile = parseArg('from-file');
  const fromS3 = parseArg('from-s3');
  if (!fromFile && !fromS3) {
    throw new Error('Either --from-file or --from-s3 must be specified');
  }
  if (fromFile && fromS3) {
    throw new Error('Specify only one of --from-file or --from-s3');
  }

  let raw: string;
  if (fromFile) {
    raw = fs.readFileSync(fromFile, 'utf8');
  } else {
    raw = await fetchFromS3(fromS3 as string);
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Input JSON must be an array of audit event objects');
  }
  // normalize to InputEvent
  return parsed as InputEvent[];
}

async function main() {
  const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connStr) {
    console.error('ERROR: set DATABASE_URL or POSTGRES_URL');
    process.exit(2);
  }

  const limitArg = parseArg('limit');
  const limit = limitArg ? Number(limitArg) : undefined;
  const force = hasFlag('force');
  const dryRun = hasFlag('dry-run');

  const events = await readInput();
  console.log(`Loaded ${events.length} events from input`);
  const toProcess = limit ? events.slice(0, limit) : events;

  const client = new Client({ connectionString: connStr });
  await client.connect();

  try {
    // We process events in ascending order of created_at if present, otherwise in input order.
    toProcess.sort((a, b) => {
      const ta = a.created_at ?? '';
      const tb = b.created_at ?? '';
      return ta.localeCompare(tb);
    });

    let idx = 0;
    for (const ev of toProcess) {
      idx += 1;
      console.log(`Processing [${idx}/${toProcess.length}] hash=${ev.hash} event_type=${ev.event_type}`);

      // Recompute digest from payload + prev_hash to ensure event.hash matches
      const prevHash = ev.prev_hash ?? null;
      const canonical = canonicalizePayload(ev.payload ?? null);
      const computedDigest = computeAuditDigest(canonical, prevHash);
      if (computedDigest !== ev.hash) {
        console.error(`  HASH_MISMATCH: computed ${computedDigest} != provided ${ev.hash}`);
        if (!force) {
          throw new Error('Hash mismatch - aborting (use --force to override)');
        } else {
          console.warn('  --force specified: continuing despite hash mismatch');
        }
      } else {
        console.log('  hash OK');
      }

      // Verify signature if present
      if (ev.signature) {
        try {
          const digestBuf = Buffer.from(ev.hash, 'hex');
          // Use auditChain verify to support multiple signers/fallbacks (KMS, Proxy, Local)
          const sigOk = await auditChain.verifySignature(ev.signature, digestBuf);
          if (!sigOk) {
            console.error('  SIG_INVALID (Verification returned false)');
            if (!force) throw new Error('Signature invalid - aborting (use --force to override)');
            else console.warn('  --force specified: continuing despite invalid signature');
          } else {
            console.log('  signature OK');
          }
        } catch (err) {
          console.error('  SIG_CHECK_ERROR:', (err as Error).message || String(err));
          if (!force) throw err;
          else console.warn('  --force specified: continuing despite signature verification error');
        }
      } else {
        console.warn('  UNSIGNED event (no signature present)');
      }

      // If dry-run, skip insertion
      if (dryRun) {
        console.log('  dry-run: not inserting');
        continue;
      }

      // Check DB head prev_hash
      const headRes = await client.query<{ hash: string }>(
        'SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE'
      );
      const dbHead = headRes.rows[0]?.hash ?? null;
      if (dbHead !== prevHash) {
        console.error(`  PREV_HASH_MISMATCH: event.prev_hash=${prevHash ?? 'null'} but db head=${dbHead ?? 'null'}`);
        if (!force) {
          throw new Error('prev_hash mismatch with DB head - aborting (use --force to override)');
        } else {
          console.warn('  --force specified: continuing despite prev_hash mismatch');
        }
      } else {
        console.log('  prev_hash matches DB head');
      }

      // Insert row; use ON CONFLICT DO NOTHING to avoid duplicates
      const insertQuery = `
        INSERT INTO audit_events
          (event_type, memory_node_id, artifact_id, payload, hash, prev_hash, signature, manifest_signature_id, created_at)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
        ON CONFLICT (hash) DO NOTHING
        RETURNING id
      `;
      const createdAt = ev.created_at ? new Date(ev.created_at).toISOString() : new Date().toISOString();
      const res = await client.query(insertQuery, [
        ev.event_type,
        ev.memory_node_id ?? null,
        ev.artifact_id ?? null,
        ev.payload ?? {},
        ev.hash,
        ev.prev_hash ?? null,
        ev.signature ?? null,
        ev.manifest_signature_id ?? null,
        createdAt
      ]);
      if (res.rowCount === 0) {
        console.log('  already present (hash conflict), skipping insert');
      } else {
        console.log(`  inserted audit_event id=${res.rows[0].id}`);
      }
    }

    console.log('Replay completed successfully.');
  } catch (err) {
    console.error('Replay failed:', (err as Error).message || String(err));
    process.exitCode = 3;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled error in auditReplay:', err);
    process.exit(1);
  });
}

export {};

