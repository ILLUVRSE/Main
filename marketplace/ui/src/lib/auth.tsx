"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'oidc-client-ts';
import { setAuthTokens } from '@/lib/api';
import {
  AUTH_MODE,
  type AuthMode,
  OIDC_CLIENT_ID,
  getOidcManager,
  attemptSilentRenew,
  mapOidcUser,
} from '@/lib/oidcClient';

export type AuthUser = {
  id?: string;
  email?: string;
  name?: string;
  roles?: string[];
  [k: string]: any;
};

type AuthContextValue = {
  token: string | null;
  accessToken: string | null;
  idToken: string | null;
  user: AuthUser | null;
  mode: AuthMode;
  loading: boolean;
  login: () => Promise<void> | void;
  logout: () => Promise<void> | void;
  setUser: (u: AuthUser | null) => void;
  isOperator: () => boolean;
};

type SessionState = {
  accessToken: string | null;
  idToken: string | null;
  user: AuthUser | null;
};

const STORAGE_KEY = 'illuvrse_ui_auth_v1';
const ctx = createContext<AuthContextValue | undefined>(undefined);

const getBase64Encoder = () => {
  const globalBtoa = typeof globalThis !== 'undefined' ? (globalThis as any).btoa : undefined;
  if (typeof globalBtoa === 'function') return globalBtoa;
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') return window.btoa.bind(window);
  const buffer = typeof globalThis !== 'undefined' ? (globalThis as any).Buffer : undefined;
  if (buffer) {
    return (value: string) => buffer.from(value, 'utf8').toString('base64');
  }
  return (value: string) => value;
};

const getBase64Decoder = () => {
  const globalAtob = typeof globalThis !== 'undefined' ? (globalThis as any).atob : undefined;
  if (typeof globalAtob === 'function') return globalAtob;
  if (typeof window !== 'undefined' && typeof window.atob === 'function') return window.atob.bind(window);
  const buffer = typeof globalThis !== 'undefined' ? (globalThis as any).Buffer : undefined;
  if (buffer) {
    return (value: string) => buffer.from(value, 'base64').toString('utf8');
  }
  return (value: string) => value;
};

const base64Encode = getBase64Encoder();
const base64Decode = getBase64Decoder();

function createMockSession(): SessionState {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 60 * 60;
  const mockUser: AuthUser = {
    id: 'user:mock',
    email: 'mock-user@illuvrse.test',
    name: 'Mock Identity',
    roles: ['buyer', 'operator'],
  };
  const encodeSegment = (payload: unknown) =>
    base64Encode(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = encodeSegment({ alg: 'HS256', kid: 'mock' });
  const buildJwt = (payload: Record<string, unknown>) => `${header}.${encodeSegment(payload)}.mock-signature`;
  return {
    accessToken: buildJwt({
      sub: mockUser.id,
      scope: 'openid profile email offline_access',
      exp: expiry,
      iss: 'mock://issuer',
      aud: OIDC_CLIENT_ID || 'illuvrse-marketplace',
    }),
    idToken: buildJwt({
      sub: mockUser.id,
      email: mockUser.email,
      name: mockUser.name,
      roles: mockUser.roles,
      exp: expiry,
      iss: 'mock://issuer',
      aud: OIDC_CLIENT_ID || 'illuvrse-marketplace',
    }),
    user: mockUser,
  };
}

async function requestDevLogin(password: string) {
  const res = await fetch('/api/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || 'Dev login failed');
  }
  return res.json() as Promise<{ token: string; user: AuthUser }>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = AUTH_MODE;
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const persistAuth = useCallback(
    (tok: string | null, usr: AuthUser | null, persist = true) => {
      if (mode !== 'dev' || typeof window === 'undefined') return;
      try {
        if (persist && tok) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: tok, user: usr }));
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } catch (err) {
        console.warn('[auth] failed to persist auth state', err);
      }
    },
    [mode]
  );

  const applySession = useCallback(
    (next: Partial<SessionState>, persistDev = false) => {
      const normalizedAccess = next.accessToken ?? null;
      const normalizedId = next.idToken ?? null;
      const normalizedUser = next.user ?? null;
      setAccessToken(normalizedAccess);
      setIdToken(normalizedId);
      setUserState(normalizedUser);
      setAuthTokens({ accessToken: normalizedAccess, idToken: normalizedId });
      if (mode === 'dev') {
        persistAuth(normalizedAccess, normalizedUser, persistDev && !!normalizedAccess);
      }
    },
    [mode, persistAuth]
  );

  useEffect(() => {
    let cancelled = false;
    if (mode === 'mock') {
      applySession(createMockSession(), false);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (mode === 'dev') {
      try {
        if (typeof window !== 'undefined') {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            applySession({ accessToken: parsed?.token ?? null, user: parsed?.user ?? null }, false);
          }
        }
      } catch (err) {
        console.warn('[auth] failed to load dev session', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }

    const manager = getOidcManager();
    if (!manager) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const syncFromOidcUser = (oidcUser: User | null) => {
      if (cancelled) return;
      if (!oidcUser) {
        applySession({ accessToken: null, idToken: null, user: null }, false);
        return;
      }
      const mappedUser = mapOidcUser(oidcUser) as AuthUser | null;
      applySession(
        {
          accessToken: oidcUser.access_token ?? null,
          idToken: oidcUser.id_token ?? null,
          user: mappedUser,
        },
        false
      );
    };

    manager
      .getUser()
      .then(async (oidcUser) => {
        if (cancelled) return;
        if (!oidcUser || oidcUser.expired) {
          try {
            const renewed = await attemptSilentRenew();
            syncFromOidcUser(renewed);
          } catch (err) {
            console.warn('[auth] silent renew unavailable; user must log in', err);
            syncFromOidcUser(null);
          }
        } else {
          syncFromOidcUser(oidcUser);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const onUserLoaded = (loaded: User) => syncFromOidcUser(loaded);
    const onUserUnloaded = () => syncFromOidcUser(null);
    const onAccessTokenExpired = () => {
      attemptSilentRenew().catch((err) => {
        console.warn('[auth] access token expired — redirecting to IdP', err);
        manager.signinRedirect().catch((redirErr) => console.error('[auth] redirect failed', redirErr));
      });
    };

    manager.events.addUserLoaded(onUserLoaded);
    manager.events.addUserUnloaded(onUserUnloaded);
    manager.events.addAccessTokenExpired(onAccessTokenExpired);

    return () => {
      cancelled = true;
      manager.events.removeUserLoaded(onUserLoaded);
      manager.events.removeUserUnloaded(onUserUnloaded);
      manager.events.removeAccessTokenExpired(onAccessTokenExpired);
    };
  }, [mode, applySession]);

  const loginWithDevPassword = useCallback(async () => {
    const secret =
      typeof window !== 'undefined'
        ? window.prompt('Enter ADMIN_PASSWORD to continue (dev fallback)')
        : undefined;
    if (!secret) return;
    try {
      const devSession = await requestDevLogin(secret);
      applySession({ accessToken: devSession.token, user: devSession.user }, true);
    } catch (err) {
      console.error('[auth] dev login failed', err);
      if (typeof window !== 'undefined') {
        window.alert('Dev login failed. Check ADMIN_PASSWORD and DEV_SKIP_OIDC settings.');
      }
    }
  }, [applySession]);

  const login = useCallback(async () => {
    if (mode === 'oidc') {
      const manager = getOidcManager();
      if (!manager) return;
      await manager.signinRedirect();
      return;
    }
    if (mode === 'mock') {
      applySession(createMockSession(), false);
      return;
    }
    await loginWithDevPassword();
  }, [mode, applySession, loginWithDevPassword]);

  const logout = useCallback(async () => {
    if (mode === 'oidc') {
      const manager = getOidcManager();
      if (manager) {
        try {
          await manager.signoutRedirect();
        } catch (err) {
          console.warn('[auth] signout redirect failed; clearing local session', err);
          await manager.removeUser().catch(() => undefined);
        }
      }
    }
    persistAuth(null, null, false);
    applySession({ accessToken: null, idToken: null, user: null }, false);
  }, [mode, applySession, persistAuth]);

  const setUser = useCallback(
    (next: AuthUser | null) => {
      setUserState(next);
      if (mode === 'dev' && typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          const parsed = raw ? JSON.parse(raw) : {};
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, user: next }));
        } catch (err) {
          console.warn('[auth] failed to persist user profile', err);
        }
      }
    },
    [mode]
  );

  const isOperator = useCallback(() => {
    return !!(user && Array.isArray(user.roles) && user.roles.includes('operator'));
  }, [user]);

  const token = accessToken || idToken;

  const value = useMemo(
    () => ({
      token,
      accessToken,
      idToken,
      user,
      mode,
      loading,
      login,
      logout,
      setUser,
      isOperator,
    }),
    [token, accessToken, idToken, user, mode, loading, login, logout, setUser, isOperator]
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

export function decodeJwtPayload<T = any>(jwt?: string | null): T | null {
  if (!jwt) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4 !== 0) {
      payload += '=';
    }
    const decoded = base64Decode(payload);
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}
