import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAuthToken as apiSetAuthToken } from '@/lib/api';
import type { ReactNode } from 'react';

/**
 * Simple client-side Auth context for the Marketplace UI.
 * - Stores a JWT (or opaque token) in localStorage in dev.
 * - Exposes login(token, user), logout(), and user/token state.
 * - Calls apiSetAuthToken() to wire the token into the API wrapper.
 *
 * NOTE: In production you should use a secure OIDC flow and avoid localStorage
 * for long-lived tokens. This helper intentionally keeps things minimal for dev.
 */

export type AuthUser = {
  id?: string;
  email?: string;
  name?: string;
  roles?: string[]; // e.g., ['buyer', 'operator']
  [k: string]: any;
};

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (token: string, user?: AuthUser, persist?: boolean) => void;
  logout: () => void;
  setUser: (u: AuthUser | null) => void;
  isOperator: () => boolean;
};

const STORAGE_KEY = 'illuvrse_ui_auth_v1';
const ctx = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Load from localStorage on mount (simple dev convenience)
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.token) {
          setToken(parsed.token);
          apiSetAuthToken(parsed.token);
        }
        if (parsed?.user) setUserState(parsed.user);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const persistAuth = useCallback((tok: string | null, usr: AuthUser | null, persist = true) => {
    try {
      if (persist && typeof window !== 'undefined') {
        const out = JSON.stringify({ token: tok, user: usr });
        window.localStorage.setItem(STORAGE_KEY, out);
      } else if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const login = useCallback((tok: string, usr: AuthUser | null = null, persist = true) => {
    setToken(tok);
    apiSetAuthToken(tok);
    setUserState(usr);
    persistAuth(tok, usr, persist);
  }, [persistAuth]);

  const logout = useCallback(() => {
    setToken(null);
    apiSetAuthToken(null);
    setUserState(null);
    persistAuth(null, null, false);
  }, [persistAuth]);

  const setUser = useCallback((u: AuthUser | null) => {
    setUserState(u);
    // update storage
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : {};
      const payload = { ...(parsed || {}), user: u };
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, []);

  const isOperator = useCallback(() => {
    return !!(user && Array.isArray(user.roles) && user.roles.includes('operator'));
  }, [user]);

  const value = useMemo(
    () => ({ token, user, loading, login, logout, setUser, isOperator }),
    [token, user, loading, login, logout, setUser, isOperator]
  );

  return <ctx.Provider value={value}>{children}</ctx.Provider>;
}

export function useAuth() {
  const c = useContext(ctx);
  if (!c) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return c;
}

/**
 * Convenience: decode a JWT payload (non-validated) for light-weight UX uses.
 * Returns null on invalid token.
 */
export function decodeJwtPayload<T = any>(jwt?: string | null): T | null {
  if (!jwt) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload);
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

