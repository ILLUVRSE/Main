// Usage: set POSTGRES_URL or DATABASE_URL in your environment, then run:
//   node kernel/tools/audit-digest-debug.js
//
// Prints JSON { id, sig_len, msg_len, digest_len } for the most-recent audit_events row.

const { Client } = require('pg');

(async () => {
  const conn = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!conn) {
    console.error('ERROR: set POSTGRES_URL or DATABASE_URL');
    process.exit(2);
  }

  const c = new Client({ connectionString: conn });
  await c.connect();

  const r = await c.query(
    "select id, payload, prev_hash, signature from audit_events order by created_at desc limit 1"
  );
  const row = r.rows[0];
  if (!row) {
    console.error('no rows');
    await c.end();
    process.exit(1);
  }

  const sig = Buffer.from(row.signature, 'base64');
  const crypto = require('crypto');

  function canon(v) {
    if (v === null || v === undefined) return Buffer.from('null');
    if (typeof v === 'boolean') return Buffer.from(v ? 'true' : 'false');
    if (typeof v === 'number') return Buffer.from(JSON.stringify(v));
    if (typeof v === 'string') return Buffer.from(JSON.stringify(v));
    if (Array.isArray(v)) {
      const parts = v.map(canon).map(b => b.toString('utf8'));
      return Buffer.from('[' + parts.join(',') + ']');
    }
    if (typeof v === 'object') {
      const entries = Object.keys(v)
        .sort()
        .map(k => JSON.stringify(k) + ':' + canon(v[k]).toString('utf8'));
      return Buffer.from('{' + entries.join(',') + '}');
    }
    return Buffer.from(JSON.stringify(v));
  }

  const msg = Buffer.concat([
    canon(row.payload ?? null),
    row.prev_hash ? Buffer.from(row.prev_hash, 'hex') : Buffer.alloc(0)
  ]);

  const dig = crypto.createHash('sha256').update(msg).digest();

  console.log(
    JSON.stringify(
      { id: row.id, sig_len: sig.length, msg_len: msg.length, digest_len: dig.length },
      null,
      2
    )
  );

  await c.end();
  process.exit(0);
})();

