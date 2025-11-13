// server/src/utils/kernel_verify.ts
import crypto from 'crypto';
import path from 'path';
import { readJson, writeJsonAtomic } from './storage';

const NONCE_PATH = path.resolve(process.cwd(), 'data', 'kernel-nonces.json');

export async function verifyKernelCallback(rawBodyBuffer: Buffer, headers: any) {
  const sigHdr = (headers['x-kernel-signature'] || headers['X-Kernel-Signature']);
  const ts = (headers['x-kernel-timestamp'] || headers['X-Kernel-Timestamp']);
  const nonce = (headers['x-kernel-nonce'] || headers['X-Kernel-Nonce']);

  if (!sigHdr || !ts || !nonce) throw new Error('Missing kernel headers');

  const now = Math.floor(Date.now()/1000);
  const tnum = Number(ts);
  if (Number.isNaN(tnum) || Math.abs(now - tnum) > 120) {
    throw new Error('Timestamp outside allowed window');
  }

  await ensureNonceStore();
  const nonces = await readJson<Record<string, number>>(NONCE_PATH, {});
  if (nonces[nonce]) throw new Error('Replay detected');
  nonces[nonce] = Date.now();
  await writeJsonAtomic(NONCE_PATH, nonces);

  const secret = process.env.KERNEL_CALLBACK_SECRET;
  if (!secret) throw new Error('No kernel callback secret configured');

  // compute expected HMAC-SHA256
  const expected = crypto.createHmac('sha256', secret).update(rawBodyBuffer).digest('hex');
  const got = sigHdr.startsWith('sha256=') ? sigHdr.slice(7) : sigHdr;
  const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(got, 'hex'));
  if (!ok) throw new Error('Invalid signature');
  return true;
}

async function ensureNonceStore() {
  try {
    await readJson(NONCE_PATH, {});
  } catch (e) {
    await writeJsonAtomic(NONCE_PATH, {});
  }
}
