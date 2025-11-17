import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';

type Role = string;

interface UserRecord {
  id: string;
  email: string;
  displayName?: string;
  roles: Role[];
  active: boolean;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface SessionRecord {
  token: string;
  userId: string;
  expiresAt: string; // ISO
  createdAt: string;
  meta?: Record<string, any>;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.warn('userService.ensureDataDir.failed', { err });
  }
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file, { encoding: 'utf-8' });
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: any) {
  try {
    await ensureDataDir();
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
    await fs.promises.rename(tmp, file);
  } catch (err) {
    logger.error('userService.writeJsonFile.failed', { err, file });
    throw err;
  }
}

/**
 * Load users and sessions (disk-backed).
 * For simplicity we lazily read/write on each operation.
 */

async function loadUsers(): Promise<UserRecord[]> {
  return await readJsonFile<UserRecord[]>(USERS_FILE, []);
}

async function saveUsers(users: UserRecord[]) {
  await writeJsonFile(USERS_FILE, users);
}

async function loadSessions(): Promise<SessionRecord[]> {
  return await readJsonFile<SessionRecord[]>(SESSIONS_FILE, []);
}

async function saveSessions(sessions: SessionRecord[]) {
  await writeJsonFile(SESSIONS_FILE, sessions);
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Minimal search helper (case-insensitive substring match against email/displayName)
 */
function matchesQuery(user: UserRecord, q?: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  if ((user.email || '').toLowerCase().includes(s)) return true;
  if ((user.displayName || '').toLowerCase().includes(s)) return true;
  return false;
}

const userService = {
  /**
   * Verify a token -> returns user object (safe shape) or null.
   * Token is looked up in session store and checked for expiry.
   */
  async verifyToken(token: string | undefined | null) {
    if (!token || typeof token !== 'string') return null;
    try {
      const sessions = await loadSessions();
      const session = sessions.find((s) => s.token === token);
      if (!session) return null;
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        // expired - remove it
        const remaining = sessions.filter((s) => s.token !== token);
        await saveSessions(remaining);
        return null;
      }
      const users = await loadUsers();
      const user = users.find((u) => u.id === session.userId && u.active);
      if (!user) return null;
      // return safe user shape
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        metadata: user.metadata || {},
      };
    } catch (err) {
      logger.error('userService.verifyToken.failed', { err });
      return null;
    }
  },

  /**
   * Create a short-lived impersonation token for the given user.
   * ttlSeconds defaults to 300.
   */
  async createImpersonationToken(userId: string, ttlSeconds = 300) {
    const users = await loadUsers();
    const user = users.find((u) => u.id === userId && u.active);
    if (!user) return null;
    const sessions = await loadSessions();
    const token = uuidv4().replace(/-/g, '');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const session: SessionRecord = {
      token,
      userId,
      expiresAt,
      createdAt: now.toISOString(),
      meta: { impersonation: true },
    };
    sessions.push(session);
    await saveSessions(sessions);
    return { token, expiresAt };
  },

  /**
   * List users with pagination and optional filters.
   * Accepts { q, page, limit, role, active }
   */
  async list(opts: { q?: string; page?: number; limit?: number; role?: string; active?: boolean } = {}) {
    const page = Math.max(1, Number(opts.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(opts.limit ?? 25)));
    const q = opts.q ? String(opts.q) : undefined;
    const role = opts.role ? String(opts.role) : undefined;
    const active = typeof opts.active === 'boolean' ? opts.active : undefined;

    const users = await loadUsers();
    let filtered = users.slice();

    if (typeof active === 'boolean') {
      filtered = filtered.filter((u) => u.active === active);
    }
    if (role) {
      filtered = filtered.filter((u) => Array.isArray(u.roles) && u.roles.includes(role));
    }
    if (q) {
      filtered = filtered.filter((u) => matchesQuery(u, q));
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit).map((u) => {
      // return minimal public info
      return {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        roles: u.roles,
        active: u.active,
        metadata: u.metadata || {},
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      };
    });

    return { total, items };
  },

  async getById(id: string) {
    const users = await loadUsers();
    const user = users.find((u) => u.id === id);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      active: user.active,
      metadata: user.metadata || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },

  /**
   * Update user metadata. Allowed fields: displayName, email, metadata
   */
  async update(id: string, changes: { displayName?: string; email?: string; metadata?: Record<string, any> }) {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    const user = users[idx];
    if (typeof changes.displayName === 'string') user.displayName = changes.displayName;
    if (typeof changes.email === 'string') user.email = changes.email;
    if (typeof changes.metadata === 'object' && changes.metadata !== null) {
      user.metadata = { ...(user.metadata || {}), ...changes.metadata };
    }
    user.updatedAt = nowIso();
    users[idx] = user;
    await saveUsers(users);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      active: user.active,
      metadata: user.metadata || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },

  /**
   * Set user roles (replace).
   */
  async setRoles(id: string, roles: string[]) {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    users[idx].roles = Array.isArray(roles) ? roles : [];
    users[idx].updatedAt = nowIso();
    await saveUsers(users);
    const u = users[idx];
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      roles: u.roles,
      active: u.active,
      metadata: u.metadata || {},
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  },

  async deactivate(id: string) {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    users[idx].active = false;
    users[idx].updatedAt = nowIso();
    await saveUsers(users);
    return true;
  },

  async activate(id: string) {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    users[idx].active = true;
    users[idx].updatedAt = nowIso();
    await saveUsers(users);
    return true;
  },

  /**
   * Soft-delete / hard-delete user record.
   */
  async delete(id: string) {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    users.splice(idx, 1);
    await saveUsers(users);

    // Remove sessions for that user
    const sessions = await loadSessions();
    const remaining = sessions.filter((s) => s.userId !== id);
    await saveSessions(remaining);
    return true;
  },

  /**
   * Create a user (helper for tests / bootstrap).
   */
  async createUser({ email, displayName, roles = ['user'], metadata = {} }: { email: string; displayName?: string; roles?: Role[]; metadata?: Record<string, any> }) {
    const users = await loadUsers();
    // ensure unique email
    if (users.some((u) => u.email === email)) {
      throw new Error('email already exists');
    }
    const id = uuidv4();
    const now = nowIso();
    const user: UserRecord = {
      id,
      email,
      displayName: displayName || email,
      roles: Array.isArray(roles) ? roles : ['user'],
      active: true,
      metadata: metadata || {},
      createdAt: now,
      updatedAt: now,
    };
    users.push(user);
    await saveUsers(users);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      active: user.active,
      metadata: user.metadata,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },

  /**
   * Soft-delete a session (logout) by token.
   */
  async revokeSession(token: string) {
    const sessions = await loadSessions();
    const remaining = sessions.filter((s) => s.token !== token);
    await saveSessions(remaining);
  },

  /**
   * Create a long-lived session token for a given user (for testing/dev).
   * ttlSeconds defaults to 86400 (1 day).
   */
  async createSession(userId: string, ttlSeconds = 86400, meta?: Record<string, any>) {
    const users = await loadUsers();
    const user = users.find((u) => u.id === userId && u.active);
    if (!user) return null;
    const sessions = await loadSessions();
    const token = uuidv4().replace(/-/g, '');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const session: SessionRecord = {
      token,
      userId,
      expiresAt,
      createdAt: now.toISOString(),
      meta,
    };
    sessions.push(session);
    await saveSessions(sessions);
    return { token, expiresAt };
  },
};

export default userService;

