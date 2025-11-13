import crypto from 'crypto';

const { verifyEvents, parseSignerRegistry, canonicalize } = require('../tools/audit-verify');

describe('audit-verify utility', () => {
  const signerId = 'test-signer';
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const spkiPublicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKeyB64 = spkiPublicKey.slice(spkiPublicKey.length - 32).toString('base64');
  const publicKeyPem = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const signerMap = new Map([[signerId, { publicKey: publicKeyB64 }]]);

  function buildEvent(id: string, eventType: string, payload: any, prevHash?: string | null): any {
    const canonical = canonicalize(payload) as Buffer;
    const prevBytes = prevHash ? Buffer.from(prevHash, 'hex') : Buffer.alloc(0);
    const hashBytes = crypto.createHash('sha256').update(Buffer.concat([canonical, prevBytes])).digest();
    const signature = crypto.sign(null, hashBytes, keyPair.privateKey);
    return {
      id,
      event_type: eventType,
      payload,
      prev_hash: prevHash ?? '',
      hash: hashBytes.toString('hex'),
      signature: signature.toString('base64'),
      signer_id: signerId,
    };
  }

  it('verifies a valid chain and returns the head hash', () => {
    const events = [] as any[];
    let prevHash: string | undefined;
    for (let i = 0; i < 3; i += 1) {
      const event = buildEvent(`id-${i}`, 'test.event', { index: i, nested: { value: i } }, prevHash);
      events.push(event);
      prevHash = event.hash;
    }

    const head = verifyEvents(events, signerMap);
    expect(head).toBe(events[events.length - 1].hash);
  });

  it('fails when prevHash chain is broken', () => {
    const first = buildEvent('id-1', 'test.event', { a: 1 }, undefined);
    const second = buildEvent('id-2', 'test.event', { b: 2 }, first.hash);
    second.prev_hash = 'deadbeef';

    expect(() => verifyEvents([first, second], signerMap)).toThrow(/prevHash mismatch/);
  });

  it('fails when computed hash differs from stored hash', () => {
    const first = buildEvent('id-1', 'test.event', { a: 1 }, undefined);
    const second = buildEvent('id-2', 'test.event', { b: 2 }, first.hash);
    second.hash = '00'.repeat(32);

    expect(() => verifyEvents([first, second], signerMap)).toThrow(/Hash mismatch/);
  });

  it('fails when signature does not verify', () => {
    const first = buildEvent('id-1', 'test.event', { a: 1 }, undefined);
    const second = buildEvent('id-2', 'test.event', { b: 2 }, first.hash);
    second.signature = first.signature; // wrong signature for event

    expect(() => verifyEvents([first, second], signerMap)).toThrow(/Signature verification failed/);
  });

  it('fails when signer is unknown', () => {
    const first = buildEvent('id-1', 'test.event', { a: 1 }, undefined);
    first.signer_id = 'unknown-signer';

    expect(() => verifyEvents([first], signerMap)).toThrow(/Unknown signer/);
  });

  it('parses signer registries from different shapes', () => {
    const arrRegistry = parseSignerRegistry([
      { signerId: 'a', publicKey: publicKeyB64 },
      { signer_id: 'b', public_key: publicKeyB64, algorithm: 'Ed25519' },
    ]);
    expect(arrRegistry.get('a')?.publicKey).toMatch(/BEGIN PUBLIC KEY/);
    expect(arrRegistry.get('b')?.publicKey).toMatch(/BEGIN PUBLIC KEY/);

    const mapRegistry = parseSignerRegistry({
      c: publicKeyB64,
      d: { publicKey: publicKeyB64 },
    });
    expect(mapRegistry.get('c')?.publicKey).toMatch(/BEGIN PUBLIC KEY/);
    expect(mapRegistry.get('d')?.publicKey).toMatch(/BEGIN PUBLIC KEY/);
  });

  it('rejects invalid public keys', () => {
    expect(() => parseSignerRegistry([{ signerId: 'bad', publicKey: 'not-base64' }])).toThrow(/Public key/);
  });

  it('normalizes algorithm names', () => {
    const reg = parseSignerRegistry([{ signerId: 'hmac', publicKey: publicKeyPem, algorithm: 'HMAC' }]);
    expect(reg.get('hmac')?.algorithm).toBe('hmac-sha256');
  });

  it('accepts hash_bytes override for ed25519 digest verification', () => {
    const events = [] as any[];
    let prevHash: string | undefined;
    for (let i = 0; i < 2; i += 1) {
      const event = buildEvent(`hash-bytes-${i}`, 'test.event', { index: i }, prevHash);
      if (i === 0) {
        event.hash_bytes = Buffer.from(event.hash, 'hex');
      } else {
        event.hash_bytes = event.hash; // hex string path
      }
      events.push(event);
      prevHash = event.hash;
    }

    const head = verifyEvents(events, signerMap);
    expect(head).toBe(prevHash);
  });
});
