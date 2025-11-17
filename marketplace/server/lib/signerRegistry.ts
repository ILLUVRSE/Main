/**
 * marketplace/server/lib/signerRegistry.ts
 *
 * Simple signer registry backed by a JSON file (kernel/tools/signers.json) for
 * development and light-weight production use. Provides helpers to list, add,
 * and remove signers. Intended to be used by admin routes such as /admin/signers.
 *
 * For production, replace or augment this with a DB-backed registry or a call to
 * Kernel's signer registration API and ensure proper auth / audit logging.
 */

import fs from 'fs';
import path from 'path';

export type SignerEntry = {
  signer_kid: string;
  public_key_pem?: string | null;
  comment?: string | null;
  deployedAt?: string | null;
};

/**
 * Default location for signers.json. This path is relative to the repository root:
 * marketplace/kernel/tools/signers.json
 */
const DEFAULT_SIGNERS_PATH = path.join(process.cwd(), 'kernel', 'tools', 'signers.json');

/* -------------------------
 * Helpers
 * ------------------------- */

function ensureDirExists(filepath: string) {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read signers from disk. If file missing, returns empty array.
 */
export async function listSigners(signersPath = DEFAULT_SIGNERS_PATH): Promise<SignerEntry[]> {
  try {
    if (!fs.existsSync(signersPath)) return [];
    const raw = await fs.promises.readFile(signersPath, 'utf8');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Support both { signers: [...] } envelope or raw array
    if (Array.isArray(parsed)) return parsed as SignerEntry[];
    if (parsed && Array.isArray(parsed.signers)) return parsed.signers as SignerEntry[];
    return [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('listSigners error:', err && (err as Error).message ? (err as Error).message : err);
    return [];
  }
}

/**
 * Persist signers list to disk as JSON with pretty formatting. Returns the written list.
 */
export async function saveSigners(signers: SignerEntry[], signersPath = DEFAULT_SIGNERS_PATH): Promise<SignerEntry[]> {
  try {
    ensureDirExists(signersPath);
    const payload = { signers };
    await fs.promises.writeFile(signersPath, JSON.stringify(payload, null, 2), { encoding: 'utf8' });
    return signers;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('saveSigners error:', err && (err as Error).message ? (err as Error).message : err);
    throw err;
  }
}

/**
 * Add a signer. If signer_kid already exists, it will be replaced.
 * Returns the added signer entry.
 */
export async function addSigner(entry: SignerEntry, signersPath = DEFAULT_SIGNERS_PATH): Promise<SignerEntry> {
  if (!entry || !entry.signer_kid) {
    throw new Error('signer_kid required');
  }
  const current = await listSigners(signersPath);
  // remove any existing with same kid
  const filtered = current.filter((s) => s.signer_kid !== entry.signer_kid);
  const now = new Date().toISOString();
  const toAdd: SignerEntry = {
    signer_kid: entry.signer_kid,
    public_key_pem: entry.public_key_pem ?? null,
    comment: entry.comment ?? null,
    deployedAt: entry.deployedAt ?? now,
  };
  filtered.unshift(toAdd);
  await saveSigners(filtered, signersPath);
  return toAdd;
}

/**
 * Remove a signer by KID. Returns true if removed, false if not found.
 */
export async function removeSigner(signer_kid: string, signersPath = DEFAULT_SIGNERS_PATH): Promise<boolean> {
  const current = await listSigners(signersPath);
  const filtered = current.filter((s) => s.signer_kid !== signer_kid);
  if (filtered.length === current.length) return false;
  await saveSigners(filtered, signersPath);
  return true;
}

/* -------------------------
 * Optional: publish to Kernel (placeholder)
 * ------------------------- */

/**
 * publishSignersToKernel
 *
 * Placeholder: implement the logic to call Kernel API to register signers if desired.
 * Example: POST /kernel/signers with the signers payload (requires mTLS or API key).
 *
 * For now, this is a no-op that returns the list passed in.
 */
export async function publishSignersToKernel(signers: SignerEntry[]): Promise<SignerEntry[]> {
  // TODO: implement kernel publishing if your Kernel exposes an API for signer registration.
  // This is a stub to keep the codebase modular.
  return signers;
}

/* -------------------------
 * Exports
 * ------------------------- */

export default {
  listSigners,
  saveSigners,
  addSigner,
  removeSigner,
  publishSignersToKernel,
};

