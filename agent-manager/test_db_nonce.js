// test_db_nonce.js
const db = require('./server/db');

(async function main(){
  try {
    await db.init();
    console.log('DB OK');

    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const nonce = 'smoke-nonce-' + Date.now();

    const inserted = await db.insertKernelNonce(nonce, expires);
    console.log('inserted:', !!inserted);

    if (inserted) {
      const isReplay = await db.isKernelNonceReplay(inserted.nonce);
      console.log('isReplay after insert:', isReplay);

      const consumed = await db.consumeKernelNonce(inserted.nonce, 'smoke-test');
      console.log('consumed?', !!consumed);

      const isReplayAfter = await db.isKernelNonceReplay(inserted.nonce);
      console.log('isReplay after consume:', isReplayAfter);
    }
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    try { await db.close(); } catch(e) {}
  }
})();

