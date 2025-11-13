#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { query } from '../src/db';

interface AuditRow {
  id: string;
  event_type: string;
  payload: any;
  prev_hash: string | null;
  hash: string;
  signature: string | null;
  signer_id: string | null;
  ts: string;
}

async function exportAudit(outDir: string): Promise<{ filePath: string; head: AuditRow | null }> {
  const res = await query<AuditRow>('SELECT * FROM audit_events ORDER BY ts ASC');
  const rows = res.rows || [];

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outDir, `audit_export_${timestamp}.jsonl`);
  const headPath = path.join(outDir, `audit_export_${timestamp}.head.json`);

  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  for (const row of rows) {
    stream.write(JSON.stringify(row));
    stream.write('\n');
  }
  stream.end();

  await new Promise<void>((resolve) => stream.on('finish', () => resolve()));

  const head = rows.length ? rows[rows.length - 1] : null;
  fs.writeFileSync(
    headPath,
    JSON.stringify(
      head
        ? {
            headHash: head.hash,
            headSignature: head.signature,
            signerId: head.signer_id,
            ts: head.ts,
            eventType: head.event_type,
          }
        : { headHash: null },
      null,
      2,
    ),
  );

  return { filePath, head };
}

async function uploadToS3(filePath: string): Promise<void> {
  const presignedUrl = process.env.AUDIT_EXPORT_S3_URL;
  if (!presignedUrl) {
    return;
  }
  const body = fs.createReadStream(filePath);
  const res = await fetch(presignedUrl, { method: 'PUT', body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload audit export to S3: ${res.status} ${text}`);
  }
}

async function main() {
  const outDir = process.argv[2] || path.resolve(process.cwd(), 'audit-exports');
  const { filePath, head } = await exportAudit(outDir);
  console.log(`[audit_export] wrote ${filePath}`);
  if (head) {
    console.log(`[audit_export] head hash ${head.hash} (signer ${head.signer_id || 'unknown'})`);
  } else {
    console.log('[audit_export] audit table empty');
  }

  if (process.env.AUDIT_EXPORT_S3_URL) {
    await uploadToS3(filePath);
    console.log('[audit_export] uploaded to S3 via AUDIT_EXPORT_S3_URL');
  }
}

main().catch((err) => {
  console.error('[audit_export] failed:', err.message || err);
  process.exit(1);
});
