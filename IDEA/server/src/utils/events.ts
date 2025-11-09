// server/src/utils/events.ts
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';

const EVENTS_PATH = path.resolve(process.cwd(), 'data', 'events.log');
const SIGNING_KEY = process.env.SERVER_SIGNING_KEY || 'dev-signing-key';

export async function emitEvent(name: string, payload: any) {
  const envelope = {
    event: name,
    payload,
    timestamp: new Date().toISOString()
  };
  const serialized = JSON.stringify(envelope);
  const signature = crypto.createHmac('sha256', SIGNING_KEY).update(serialized).digest('hex');
  const record = JSON.stringify({ envelope, signature }) + '\n';
  await fs.mkdir(path.dirname(EVENTS_PATH), { recursive: true });
  await fs.appendFile(EVENTS_PATH, record, 'utf8');
  return { envelope, signature };
}

