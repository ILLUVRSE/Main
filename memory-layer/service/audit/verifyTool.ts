/**
 * memory-layer/service/audit/verifyTool.ts
 *
 * CLI to verify audit_events chain and signatures for the Memory Layer.
 * Supports verifying directly from DB or from an exported JSON file.
 * Also supports dumping DB range to JSON file.
 *
 * Usage:
 *   # Verify DB:
 *   DATABASE_URL=... npx ts-node verifyTool.ts [--limit=N] [--start=ID]
 *
 *   # Dump DB to file:
 *   DATABASE_URL=... npx ts-node verifyTool.ts --dump-to=audit_export.json [--limit=N]
 *
 *   # Verify file:
 *   npx ts-node verifyTool.ts --verify-file=audit_export.json
 *
 * Behavior:
 *  - Verifies prev_hash chaining (each row.prev_hash === previousRow.hash).
 *  - Recomputes digest via canonicalizePayload + computeAuditDigest and compares to stored `hash`.
 *  - If signature present, calls auditChain.verifySignature(signatureBase64, digest).
 *
 * Exit code: 0 if everything verified; non-zero if any failures detected.
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import auditChain from './auditChain';

type AuditRow = {
  id: string;
  event_type: string;
  payload: any;
  prev_hash: string | null;
  hash: string;
  signature: string | null;
  signer_id: string | null; // Added in migration 004
  manifest_signature_id: string | null;
  created_at: string;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main() {
  const dumpFile = parseArg('dump-to');
  const verifyFile = parseArg('verify-file') || parseArg('export-file'); // Alias for task compatibility
  const limitArg = parseArg('limit');
  const startId = parseArg('start');
  const limit = limitArg ? Number(limitArg) : undefined;

  // Mode 1: Verify from File
  if (verifyFile) {
    await verifyFromFile(verifyFile);
    return;
  }

  // Mode 2: DB Operations (Verify or Dump)
  const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connStr) {
    console.error('ERROR: set DATABASE_URL or POSTGRES_URL, or use --verify-file=...');
    process.exit(2);
  }

  const client = new Client({ connectionString: connStr });
  await client.connect();

  try {
    const rows = await fetchRows(client, startId, limit);

    if (dumpFile) {
      console.log(`Dumping ${rows.length} rows to ${dumpFile}...`);
      fs.writeFileSync(dumpFile, JSON.stringify(rows, null, 2));
      console.log('Dump complete.');
    } else {
      await verifyRows(rows);
    }
  } catch (err) {
    console.error('ERROR:', (err as Error).message || String(err));
    process.exitCode = 4;
  } finally {
    await client.end();
  }
}

async function fetchRows(client: Client, startId?: string, limit?: number): Promise<AuditRow[]> {
  const qParts: string[] = [
    'SELECT id, event_type, payload, prev_hash, hash, signature, signer_id, manifest_signature_id, created_at',
    'FROM audit_events'
  ];
  const params: any[] = [];
  if (startId) {
    params.push(startId);
    qParts.push(`WHERE created_at > (SELECT created_at FROM audit_events WHERE id = $${params.length})`);
  }
  qParts.push('ORDER BY created_at ASC'); // Must be linear order
  if (limit) {
    params.push(limit);
    qParts.push(`LIMIT $${params.length}`);
  }
  const query = qParts.join(' ');
  const res = await client.query<AuditRow>(query, params);
  return res.rows;
}

async function verifyFromFile(filepath: string) {
  console.log(`Reading audit events from ${filepath}...`);
  const content = fs.readFileSync(filepath, 'utf8');
  const rows = JSON.parse(content) as AuditRow[];
  if (!Array.isArray(rows)) {
    throw new Error('File content must be a JSON array of audit events');
  }
  await verifyRows(rows);
}

async function verifyRows(rows: AuditRow[]) {
  if (!rows.length) {
    console.log('No audit_events to verify.');
    return;
  }

  let lastHashSeen: string | null = null;
  // If we are verifying a slice (startId set), we might not know the previous hash.
  // But for file verification or full DB scan, we assume we start from beginning OR we trust the first prev_hash matches "something".
  // However, strict chaining check requires row.prev_hash === lastHashSeen.
  // If this is the FIRST row fetched, we set lastHashSeen = row.prev_hash so the first check passes (unless it's genesis).

  if (rows.length > 0) {
    lastHashSeen = rows[0].prev_hash;
  }

  let anyFailures = false;
  let idx = 0;

  console.log(`Verifying ${rows.length} audit events...`);
  for (const row of rows) {
    idx += 1;

    const canonical = auditChain.canonicalizePayload(row.payload ?? null);
    const computedDigestHex = auditChain.computeAuditDigest(canonical, row.prev_hash ?? null);

    const chainOk = row.prev_hash === lastHashSeen;
    const hashMatches = computedDigestHex === row.hash;
    let sigValid = false;
    let sigError: string | null = null;
    const signaturePresent = Boolean(row.signature);

    if (signaturePresent) {
      try {
        const digestBuf = Buffer.from(computedDigestHex, 'hex');
        sigValid = await auditChain.verifySignature(row.signature as string, digestBuf);
      } catch (err) {
        sigError = (err as Error).message || String(err);
      }
    }

    const rowIssues: string[] = [];
    if (!chainOk) rowIssues.push(`CHAIN_BROKEN(prev=${row.prev_hash}, expected=${lastHashSeen})`);
    if (!hashMatches) rowIssues.push(`HASH_MISMATCH(computed=${computedDigestHex}, stored=${row.hash})`);
    if (!signaturePresent) rowIssues.push('UNSIGNED');
    else if (!sigValid) {
      rowIssues.push(sigError ? `SIG_INVALID(${sigError})` : 'SIG_INVALID');
    }

    if (rowIssues.length) anyFailures = true;

    // Verbose logging for failures or sampled success?
    // Let's log failures always.
    if (rowIssues.length) {
        console.log(
            `[${idx.toString().padStart(3)}] FAIL id=${row.id} type=${row.event_type}`
        );
        console.log(`       ISSUES: ${rowIssues.join('; ')}`);
    }

    lastHashSeen = row.hash;
  }

  // Check genesis constraint if we started from the absolute beginning?
  // Hard to know if we fetched from beginning without context.
  // But if row[0].prev_hash is NULL, it should be genesis.

  if (anyFailures) {
    console.error('Verification completed: FAILURES detected.');
    process.exitCode = 3;
  } else {
    console.log('Verification completed: all checked rows OK.');
    process.exitCode = 0;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(5);
  });
}

export {};
