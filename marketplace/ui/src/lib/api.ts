export function setAuthToken(token?: string) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem('illuvrse.authToken', token);
  else localStorage.removeItem('illuvrse.authToken');
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('illuvrse.authToken');
}

export async function apiFetch(input: RequestInfo, init: RequestInit = {}) {
  const token = getAuthToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
  return res.json().catch(() => null);
}
