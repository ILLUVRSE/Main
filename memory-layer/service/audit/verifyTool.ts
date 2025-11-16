/**
 * memory-layer/service/audit/verifyTool.ts
 *
 * CLI to verify audit_events chain and signatures for the Memory Layer.
 *
 * Usage (via ts-node):
 *   DATABASE_URL=... npx ts-node memory-layer/service/audit/verifyTool.ts [--limit=N] [--start=ID]
 *
 * Behavior:
 *  - Verifies prev_hash chaining (each row.prev_hash === previousRow.hash).
 *  - Recomputes digest via canonicalizePayload + computeAuditDigest and compares to stored `hash`.
 *  - If signature present, calls auditChain.verifySignature(signatureBase64, Buffer.from(digestHex,'hex')).
 *
 * Exit code: 0 if everything verified; non-zero if any failures detected.
 */

import { Client } from 'pg';
import auditChain from './auditChain';

type AuditRow = {
  id: string;
  event_type: string;
  payload: any;
  prev_hash: string | null;
  hash: string;
  signature: string | null;
  manifest_signature_id: string | null;
  created_at: string;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main() {
  const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connStr) {
    console.error('ERROR: set DATABASE_URL or POSTGRES_URL');
    process.exit(2);
  }

  const limitArg = parseArg('limit');
  const startId = parseArg('start'); // optional audit_event id to start after (exclusive)
  const limit = limitArg ? Number(limitArg) : undefined;

  const client = new Client({ connectionString: connStr });
  await client.connect();

  try {
    const qParts: string[] = [
      'SELECT id, event_type, payload, prev_hash, hash, signature, manifest_signature_id, created_at',
      'FROM audit_events'
    ];
    const params: any[] = [];
    if (startId) {
      params.push(startId);
      qParts.push(`WHERE created_at > (SELECT created_at FROM audit_events WHERE id = $${params.length})`);
    }
    qParts.push('ORDER BY created_at ASC');
    if (limit) {
      params.push(limit);
      qParts.push(`LIMIT $${params.length}`);
    }
    const query = qParts.join(' ');
    const res = await client.query<AuditRow>(query, params);

    if (!res.rows.length) {
      console.log('No audit_events rows found for the query.');
      await client.end();
      return;
    }

    let lastHashSeen: string | null = null;
    let anyFailures = false;
    let idx = 0;

    console.log(`Verifying ${res.rows.length} audit events...`);
    for (const row of res.rows) {
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
      if (!chainOk) rowIssues.push('CHAIN_BROKEN(prev_hash != previous.hash)');
      if (!hashMatches) rowIssues.push('HASH_MISMATCH(computed != stored)');
      if (!signaturePresent) rowIssues.push('UNSIGNED');
      else if (!sigValid) {
        rowIssues.push(sigError ? `SIG_INVALID(${sigError})` : 'SIG_INVALID');
      }

      if (rowIssues.length) anyFailures = true;

      console.log(
        `[${idx.toString().padStart(3)}] id=${row.id} ts=${row.created_at} type=${row.event_type} manifestSig=${row.manifest_signature_id ?? 'n/a'}`
      );
      console.log(`       prev_hash=${row.prev_hash ?? 'null'}`);
      console.log(`       stored_hash=${row.hash}`);
      console.log(`       computed_hash=${computedDigestHex}`);
      console.log(`       chain_ok=${chainOk}  hash_ok=${hashMatches}  signature_present=${signaturePresent}  sig_ok=${sigValid}`);
      if (sigError) console.log(`       sig_error=${sigError}`);
      if (rowIssues.length) console.log(`       ISSUES: ${rowIssues.join('; ')}`);
      console.log('');

      lastHashSeen = row.hash;
    }

    // Additional consistency check: ensure prev_hash of first row is null (optional)
    const firstRow = res.rows[0];
    if (firstRow.prev_hash !== null) {
      console.warn('Warning: first audit_events row has non-null prev_hash (expected null).');
      anyFailures = true;
    }

    if (anyFailures) {
      console.error('Verification completed: FAILURES detected.');
      process.exitCode = 3;
    } else {
      console.log('Verification completed: all rows OK.');
      process.exitCode = 0;
    }
  } catch (err) {
    console.error('ERROR running verification:', (err as Error).message || String(err));
    process.exitCode = 4;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(5);
  });
}

export {};

