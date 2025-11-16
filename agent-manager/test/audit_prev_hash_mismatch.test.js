const crypto = require('crypto');

const { canonicalize } = require('../server/audit_signer');
const { verifyEvents } = require('../../kernel/tools/audit-verify');

function buildEvent({ payload, prevHashHex, signerId, privateKey }) {
  const canonical = Buffer.from(canonicalize(payload), 'utf8');
  const prevBytes = prevHashHex ? Buffer.from(prevHashHex, 'hex') : Buffer.alloc(0);
  const concat = Buffer.concat([canonical, prevBytes]);
  const hashBytes = crypto.createHash('sha256').update(concat).digest();
  const signature = crypto
    .sign('sha256', concat, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING })
    .toString('base64');

  return {
    payload,
    prev_hash: prevHashHex || '',
    signature,
    signer_kid: signerId,
    hash: hashBytes.toString('hex'),
  };
}

describe('audit chain prev_hash enforcement', () => {
  it('fails verification when prev_hash does not match chain', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: 0x10001,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const signerId = 'chain-test';

    const first = buildEvent({
      payload: { step: 'spawn', id: 1 },
      prevHashHex: '',
      signerId,
      privateKey,
    });
    const second = buildEvent({
      payload: { step: 'ingest', id: 2 },
      prevHashHex: first.hash,
      signerId,
      privateKey,
    });
    const tampered = { ...second, prev_hash: '00'.repeat(32) }; // corrupt the chain
    const third = buildEvent({
      payload: { step: 'promote', id: 3 },
      prevHashHex: tampered.hash,
      signerId,
      privateKey,
    });

    const signerMap = new Map([[signerId, { publicKey, algorithm: 'rsa-sha256' }]]);

    await expect(verifyEvents([first, tampered, third], signerMap)).rejects.toThrow(/prevHash mismatch/i);
    await expect(verifyEvents([first, second, third], signerMap)).resolves.toBeDefined();
  });
});
