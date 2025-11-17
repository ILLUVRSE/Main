#!/usr/bin/env node
/**
 * marketplace/tools/export_audit_batch.js
 *
 * CLI wrapper to export audit events for a time range and upload to S3 (or write to local file).
 *
 * Usage:
 *   node export_audit_batch.js --from "2025-11-17T00:00:00Z" --to "2025-11-17T23:59:59Z" --out /tmp/out.jsonl.gz --env prod
 *
 * If --out is provided, that path will be used as a local fallback. The auditWriter will still prefer S3 if configured.
 */

const path = require('path');

function usage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--from ISO --to ISO --out PATH --env TAG]
Options:
  --from    ISO timestamp (default: 24h ago)
  --to      ISO timestamp (default: now)
  --out     local path to write file if S3 not configured (optional)
  --env     environment tag (default: NODE_ENV or 'dev')
  --help    show this help
Example:
  node tools/export_audit_batch.js --from "2025-11-17T00:00:00Z" --to "2025-11-17T23:59:59Z" --env prod
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      break;
    }
    if (a === '--from') {
      args.from = argv[++i];
      continue;
    }
    if (a === '--to') {
      args.to = argv[++i];
      continue;
    }
    if (a === '--out') {
      args.out = argv[++i];
      continue;
    }
    if (a === '--env') {
      args.envTag = argv[++i];
      continue;
    }
    // unknown - ignore
  }
  return args;
}

async function main() {
  const argv = parseArgs(process.argv);
  if (argv.help) {
    usage();
    process.exit(0);
  }

  const from = argv.from || null;
  const to = argv.to || null;
  const outPath = argv.out || undefined;
  const envTag = argv.envTag || process.env.NODE_ENV || 'dev';

  // Lazy require of auditWriter
  let auditWriter;
  try {
    // eslint-disable-next-line global-require
    auditWriter = require('../server/lib/auditWriter');
    if (!auditWriter || typeof auditWriter.exportAuditBatch !== 'function') {
      console.error('Error: server/lib/auditWriter.exportAuditBatch not found or invalid.');
      process.exit(2);
    }
  } catch (e) {
    console.error('Failed to load auditWriter:', e && e.message ? e.message : e);
    process.exit(3);
  }

  console.log('[export_audit_batch] Starting export with options:', { from, to, outPath, envTag });

  try {
    const res = await auditWriter.exportAuditBatch({ from, to, outPath, envTag });
    console.log('[export_audit_batch] Export result:', JSON.stringify(res, null, 2));
    if (res && res.location) {
      console.log(`[export_audit_batch] Exported to: ${res.location}`);
    } else {
      console.log('[export_audit_batch] Export completed (no location returned)');
    }
    process.exit(0);
  } catch (err) {
    console.error('[export_audit_batch] Export failed:', err && err.message ? err.message : err);
    process.exit(5);
  }
}

if (require.main === module) {
  main();
}

