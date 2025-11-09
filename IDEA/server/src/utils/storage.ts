import fs from 'fs/promises';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';

const DEFAULT_TIMEOUT_MS = 5000;

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function acquireLock(filePath: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();

  await ensureDir(lockPath);

  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      return async () => {
        await handle.close();
        try {
          await fs.unlink(lockPath);
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            throw err;
          }
        }
      };
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        if (Date.now() - start > timeoutMs) {
          throw new Error('Timed out waiting for storage lock. Try again shortly.');
        }
        await sleep(50);
        continue;
      }
      throw err;
    }
  }
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return fallback;
    }
    throw new Error(`Failed to read JSON from ${filePath}: ${err?.message ?? err}`);
  }
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const release = await acquireLock(filePath);
  let tempPath: string | null = null;
  try {
    await ensureDir(filePath);
    tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(data, null, 2);
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (err) {
    throw new Error(`Failed to write JSON to ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (tempPath) {
      await fs.unlink(tempPath).catch(() => undefined);
    }
    await release();
  }
}
