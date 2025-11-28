import { Project, ProjectPreview, SignResponse } from '@/types/project';

type AuthTokens = {
  accessToken?: string | null;
  idToken?: string | null;
};

const DEFAULT_API_BASE = 'http://localhost:4001';

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL)?.replace(/\/$/, '') || DEFAULT_API_BASE;

let activeTokens: AuthTokens = {};

export function setAuthTokens(tokens: AuthTokens | null) {
  activeTokens = {
    accessToken: tokens?.accessToken ?? null,
    idToken: tokens?.idToken ?? null,
  };
}

export function setAuthToken(token: string | null) {
  setAuthTokens({ accessToken: token });
}

function buildUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (activeTokens.accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${activeTokens.accessToken}`);
  }

  if (activeTokens.idToken && !headers.has('x-id-token')) {
    headers.set('x-id-token', activeTokens.idToken);
  }

  const response = await fetch(buildUrl(path), {
    cache: 'no-store',
    ...init,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API ${response.status}: ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

export function listProjects(): Promise<Project[]> {
  return request('/api/projects');
}

export function getProject(id: string): Promise<Project> {
  return request(`/api/projects/${id}`);
}

export function previewProject(id: string): Promise<ProjectPreview> {
  return request(`/api/projects/${id}/preview`, { method: 'POST' });
}

export function requestSign(id: string): Promise<SignResponse> {
  return request('/api/kernel/sign', {
    method: 'POST',
    body: JSON.stringify({ projectId: id }),
  });
}

export function postLicenseVerify(license: unknown, expectedBuyerId?: string) {
  return request('/api/licenses/verify', {
    method: 'POST',
    body: JSON.stringify({ license, expectedBuyerId }),
  });
}

export function getProof(proofId: string) {
  return request(`/api/proofs/${proofId}`);
}

const api = {
  listProjects,
  getProject,
  previewProject,
  requestSign,
  postLicenseVerify,
  getProof,
};

export default api;
