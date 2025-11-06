#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const ED25519_SPki_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function canonicalize(value) {
  if (value === null || value === undefined) {
    return Buffer.from('null');
  }

  if (typeof value === 'boolean') {
    return Buffer.from(value ? 'true' : 'false');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number encountered during canonicalization: ${value}`);
    }
    return Buffer.from(JSON.stringify(value));
  }

  if (typeof value === 'string') {
    return Buffer.from(JSON.stringify(value));
  }

  if (Array.isArray(value)) {
    const parts = value.map((entry) => canonicalize(entry));
    return Buffer.from(`[${parts.map((buf) => buf.toString('utf8')).join(',')}]`);
  }

  if (typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => {
        const encodedKey = JSON.stringify(key);
        const encodedValue = canonicalize(value[key]).toString('utf8');
        return `${encodedKey}:${encodedValue}`;
      });
    return Buffer.from(`{${entries.join(',')}}`);
  }

  // Fallback: serialize using JSON.stringify
  return Buffer.from(JSON.stringify(value));
}

function parseSignerRegistry(raw) {
  if (!raw || (typeof raw !== 'object' && !Array.isArray(raw))) {
    throw new Error('Signer registry must be an object or array');
  }

  let entries;
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (Array.isArray(raw.signers)) {
    entries = raw.signers;
  } else {
    entries = Object.keys(raw).map((id) => {
      const val = raw[id];
      if (typeof val === 'string') {
        return { signerId: id, publicKey: val, algorithm: 'Ed25519' };
      }
      return { signerId: id, ...(val || {}) };
    });
  }

  const map = new Map();
  for (const entry of entries) {
    if (!entry) continue;
    const signerId = entry.signerId || entry.signer_id || entry.id;
    const publicKey = entry.publicKey || entry.public_key;
    const algorithm = entry.algorithm || entry.alg || 'Ed25519';
    if (!signerId || !publicKey) {
      throw new Error('Each signer entry must include signerId and publicKey');
    }
    if (!/^Ed25519$/i.test(algorithm)) {
      throw new Error(`Unsupported algorithm for signer ${signerId}: ${algorithm}`);
    }
    const normalizedKey = publicKey.trim();
    // Validate base64
    let decoded;
    try {
      decoded = Buffer.from(normalizedKey, 'base64');
    } catch (err) {
      throw new Error(`Invalid base64 public key for signer ${signerId}`);
    }
    if (decoded.length !== 32) {
      throw new Error(`Public key for signer ${signerId} must be 32 bytes after base64 decoding`);
    }
    map.set(signerId, { publicKey: normalizedKey, algorithm: 'Ed25519' });
  }
  return map;
}

function createKeyObject(publicKeyB64) {
  const raw = Buffer.from(publicKeyB64, 'base64');
  if (raw.length !== 32) {
    throw new Error('Ed25519 public key must be 32 bytes');
  }
  const spki = Buffer.concat([ED25519_SPki_PREFIX, raw]);
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

function verifyEvents(events, signerMap) {
  if (!(signerMap instanceof Map)) {
    throw new Error('signerMap must be a Map of signerId -> { publicKey }');
  }

  const keyCache = new Map();
  let expectedPrev = '';
  let headHash = '';

  events.forEach((row, index) => {
    const id = row.id || row.ID;
    const signerId = row.signer_id || row.signerId;
    if (!signerId) {
      throw new Error(`Missing signerId for event ${id || `#${index + 1}`}`);
    }
    const signerInfo = signerMap.get(signerId);
    if (!signerInfo) {
      throw new Error(`Unknown signer ${signerId} for event ${id || `#${index + 1}`}`);
    }

    const storedPrev = row.prev_hash || row.prevHash || '';
    const storedHash = row.hash;
    const storedSignature = row.signature;

    if (!storedHash) {
      throw new Error(`Missing hash for event ${id || `#${index + 1}`}`);
    }
    if (!storedSignature) {
      throw new Error(`Missing signature for event ${id || `#${index + 1}`}`);
    }

    const payload = row.payload ?? null;
    const canonical = canonicalize(payload);
    const prevBytes = storedPrev ? Buffer.from(storedPrev, 'hex') : Buffer.alloc(0);
    const hashBytes = crypto
      .createHash('sha256')
      .update(Buffer.concat([canonical, prevBytes]))
      .digest();
    const computedHash = hashBytes.toString('hex');

    if (expectedPrev && storedPrev !== expectedPrev) {
      throw new Error(
        `prevHash mismatch for event ${id || `#${index + 1}`}: expected ${expectedPrev} but got ${storedPrev || ''}`,
      );
    }

    if (computedHash !== storedHash) {
      throw new Error(
        `Hash mismatch for event ${id || `#${index + 1}`}: computed ${computedHash} but stored ${storedHash}`,
      );
    }

    let keyObject = keyCache.get(signerId);
    if (!keyObject) {
      keyObject = createKeyObject(signerInfo.publicKey);
      keyCache.set(signerId, keyObject);
    }

    let signatureBytes;
    try {
      signatureBytes = Buffer.from(storedSignature, 'base64');
    } catch (err) {
      throw new Error(`Invalid signature encoding for event ${id || `#${index + 1}`}`);
    }

    const ok = crypto.verify(null, hashBytes, keyObject, signatureBytes);
    if (!ok) {
      throw new Error(`Signature verification failed for event ${id || `#${index + 1}`}`);
    }

    expectedPrev = storedHash;
    headHash = storedHash;
  });

  return headHash;
}

async function fetchEvents(client) {
  const query =
    'SELECT id, event_type, payload, prev_hash, hash, signature, signer_id FROM audit_events ORDER BY ts ASC';
  const res = await client.query(query);
  return res.rows;
}

async function verifyAuditChain(options = {}) {
  const { databaseUrl = process.env.POSTGRES_URL, signerMap, client: providedClient } = options;
  let signerRegistry = signerMap;
  if (!signerRegistry) {
    const signerSource = options.signerSource || process.env.AUDIT_SIGNERS_FILE || process.env.AUDIT_SIGNERS_JSON;
    if (!signerSource) {
      throw new Error('Signer registry not provided. Use --signers or set AUDIT_SIGNERS_FILE/AUDIT_SIGNERS_JSON.');
    }
    if (fs.existsSync(signerSource)) {
      const fileContent = fs.readFileSync(path.resolve(signerSource), 'utf8');
      signerRegistry = parseSignerRegistry(JSON.parse(fileContent));
    } else {
      signerRegistry = parseSignerRegistry(JSON.parse(signerSource));
    }
  }

  if (!(signerRegistry instanceof Map)) {
    throw new Error('signerRegistry must be a Map instance');
  }

  if (!databaseUrl && !providedClient) {
    throw new Error('Database URL must be provided via --database-url or POSTGRES_URL');
  }

  const client = providedClient || new Client({ connectionString: databaseUrl });
  let shouldClose = false;
  if (!providedClient) {
    await client.connect();
    shouldClose = true;
  }

  try {
    const rows = await fetchEvents(client);
    const head = verifyEvents(rows, signerRegistry);
    return head;
  } finally {
    if (shouldClose) {
      await client.end();
    }
  }
}

function printHelp() {
  console.log(`Usage: node audit-verify.js [options]\n\nOptions:\n  -d, --database-url <url>   Postgres connection string (defaults to POSTGRES_URL)\n  -s, --signers <path|json>   Path to signer registry JSON or inline JSON string.\n  -h, --help                  Show this help message.\n\nSigner registry format:\n  {\n    "signers": [\n      { "signerId": "kernel-signer", "publicKey": "<base64>", "algorithm": "Ed25519" }\n    ]\n  }\n  // or a map: { "kernel-signer": "<base64>" }\n`);
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }

  let databaseUrl;
  let signerSource;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-d' || arg === '--database-url') {
      databaseUrl = args[i + 1];
      i += 1;
    } else if (arg === '-s' || arg === '--signers') {
      signerSource = args[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  try {
    const signerMap = signerSource
      ? parseSignerRegistry(
          fs.existsSync(signerSource)
            ? JSON.parse(fs.readFileSync(path.resolve(signerSource), 'utf8'))
            : JSON.parse(signerSource),
        )
      : undefined;
    const head = await verifyAuditChain({ databaseUrl, signerMap });
    if (head) {
      console.log(`Audit chain verified. Head hash: ${head}`);
    } else {
      console.log('Audit chain verified. No events found.');
    }
  } catch (err) {
    console.error('Audit verification failed:', err.message || err);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  canonicalize,
  parseSignerRegistry,
  createKeyObject,
  verifyEvents,
  verifyAuditChain,
};
