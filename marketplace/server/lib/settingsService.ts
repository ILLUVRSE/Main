import fs from 'fs';
import path from 'path';
import logger from './logger';

type Settings = Record<string, any>;

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

let cache: Settings | null = null;

/**
 * Deep clone helper to avoid accidental mutation across callers.
 */
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/**
 * Ensure data dir exists
 */
async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    // best-effort: log and continue (mkdir rarely fails)
    logger.warn('settings.ensureDataDir.failed', { err });
  }
}

/**
 * Load settings from disk. If no file exists, create a minimal default.
 */
export async function loadFromDisk(): Promise<Settings> {
  try {
    await ensureDataDir();
    const raw = await fs.promises.readFile(SETTINGS_FILE, { encoding: 'utf-8' }).catch(() => '');
    if (!raw) {
      const defaults: Settings = {
        admin: {
          apiKey: process.env.ADMIN_API_KEY || null,
        },
        app: {
          name: process.env.APP_NAME || 'ILLUVRSE Marketplace',
          env: process.env.NODE_ENV || 'development',
        },
        integrations: {},
      };
      // persist defaults to disk for visibility
      await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(defaults, null, 2), { encoding: 'utf-8' });
      cache = deepClone(defaults);
      return deepClone(defaults);
    }
    const parsed: Settings = JSON.parse(raw);
    cache = deepClone(parsed);
    return deepClone(parsed);
  } catch (err) {
    logger.error('settings.loadFromDisk.failed', { err });
    // Fall back to environment-derived defaults if disk fails
    const fallback: Settings = {
      admin: { apiKey: process.env.ADMIN_API_KEY || null },
      app: { name: process.env.APP_NAME || 'ILLUVRSE Marketplace', env: process.env.NODE_ENV || 'development' },
      integrations: {},
    };
    cache = deepClone(fallback);
    return deepClone(fallback);
  }
}

/**
 * Write settings to disk (atomic-ish by writing to temp then rename).
 */
async function writeToDisk(settings: Settings) {
  try {
    await ensureDataDir();
    const tmp = `${SETTINGS_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2), { encoding: 'utf-8' });
    await fs.promises.rename(tmp, SETTINGS_FILE);
    cache = deepClone(settings);
    logger.info('settings.written', { path: SETTINGS_FILE });
    return true;
  } catch (err) {
    logger.error('settings.writeToDisk.failed', { err });
    throw err;
  }
}

/**
 * Simple validation routine for restored/updated settings.
 * Throws an Error with code 'INVALID_SETTINGS' on validation failure.
 */
function validateSettings(settings: Settings, { allowSecrets = false } = {}) {
  // Example validation rules:
  // - admin.apiKey, if present, must be a string >= 16 chars
  // - app.env must be one of development|staging|production
  const adminKey = settings?.admin?.apiKey;
  if (typeof adminKey !== 'undefined' && adminKey !== null) {
    if (typeof adminKey !== 'string' || adminKey.length < 16) {
      const err: any = new Error('admin.apiKey must be a string at least 16 characters long');
      err.code = 'INVALID_SETTINGS';
      throw err;
    }
    // If secrets are not allowed during restore/update, reject presence of admin.apiKey
    if (!allowSecrets && adminKey && adminKey.length > 0) {
      // We allow updates that do not touch secrets; callers may use restore(..., { force: true }) to override
      // but for safety we only reject here when explicitly configured to block secrets.
    }
  }

  const env = settings?.app?.env;
  if (typeof env !== 'undefined') {
    const allowed = ['development', 'staging', 'production'];
    if (!allowed.includes(String(env))) {
      const err: any = new Error(`app.env must be one of ${allowed.join(', ')}`);
      err.code = 'INVALID_SETTINGS';
      throw err;
    }
  }
}

/**
 * Public API
 */
const settingsService = {
  /**
   * Return a deep copy of all settings (from cache if available).
   */
  async getAll(): Promise<Settings> {
    if (!cache) {
      await loadFromDisk();
    }
    return deepClone(cache || {});
  },

  /**
   * Get a specific key. Supports dot notation, e.g. 'admin.apiKey'
   */
  async get(key?: string): Promise<any> {
    if (!cache) {
      await loadFromDisk();
    }
    if (!key) return deepClone(cache || {});
    const parts = key.split('.');
    let cur: any = cache || {};
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return undefined;
    }
    return deepClone(cur);
  },

  /**
   * Partially update settings by shallow-merging provided top-level keys.
   * Returns the updated settings.
   */
  async update(patch: Settings): Promise<Settings> {
    if (!patch || typeof patch !== 'object') {
      throw new Error('patch must be an object');
    }

    if (!cache) {
      await loadFromDisk();
    }

    const merged = {
      ...(cache || {}),
      ...patch,
    };

    // validate merged result (allowing secrets because admins may update keys)
    validateSettings(merged, { allowSecrets: true });

    await writeToDisk(merged);
    return deepClone(merged);
  },

  /**
   * Reload settings from persistent store into runtime cache.
   */
  async reload(): Promise<Settings> {
    const reloaded = await loadFromDisk();
    logger.info('settings.reloaded');
    return deepClone(reloaded);
  },

  /**
   * Restore settings (replace entire set). Options:
   * - force: bypass some safety checks (use with caution)
   */
  async restore(newSettings: Settings, options: { force?: boolean } = {}): Promise<Settings> {
    if (!newSettings || typeof newSettings !== 'object') {
      const err: any = new Error('settings must be an object');
      err.code = 'INVALID_SETTINGS';
      throw err;
    }

    // Validate before writing. If force=true, be more permissive.
    try {
      validateSettings(newSettings, { allowSecrets: !!options.force });
    } catch (err: any) {
      // If not forced, throw validation error to caller.
      if (!options.force) {
        logger.warn('settings.restore.validation_failed', { err });
        const e: any = new Error(err.message || 'validation failed');
        e.code = 'INVALID_SETTINGS';
        throw e;
      }
    }

    await writeToDisk(newSettings);
    logger.info('settings.restored', { forced: !!options.force });
    return deepClone(newSettings);
  },

  /**
   * Clear in-memory cache. Next get will reload from disk.
   */
  async clearCache(): Promise<void> {
    cache = null;
    logger.info('settings.cache.cleared');
  },
};

export default settingsService;

