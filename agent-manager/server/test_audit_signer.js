// agent-manager/server/test_audit_signer.js
const signer = require('./audit_signer');
const db = require('../server/db') || require('./db');

(async function main() {
  try {
    await db.init();
    console.log('DB OK');

    const ev = await signer.createSignedAuditEvent('test-runner', 'test_event', { hello: 'world', n: Date.now() });
    console.log('created signed audit event:', ev);

    // create a second event to exercise prev_hash chaining
    const ev2 = await signer.createSignedAuditEvent('test-runner', 'test_event', { hello: 'again', n: Date.now() });
    console.log('created signed audit event 2:', ev2);

  } catch (err) {
    console.error('TEST ERROR', err);
    process.exit(2);
  } finally {
    try { await db.close(); } catch (e) {}
    process.exit(0);
  }
})();

