// server/src/utils/hash.ts
import crypto from 'crypto';
import fs from 'fs';
import axios from 'axios';

export async function sha256FromFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

export async function sha256FromUrl(url: string): Promise<string> {
  const h = crypto.createHash('sha256');
  const r = await axios.get(url, { responseType: 'stream', timeout: 120000 });
  return new Promise<string>((resolve, reject) => {
    r.data.on('data', (d:any) => h.update(d));
    r.data.on('end', () => resolve(h.digest('hex')));
    r.data.on('error', reject);
  });
}

