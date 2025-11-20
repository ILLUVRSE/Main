import type {
  CatalogResponse,
  KernelManifest,
  OrderRecord,
  PreviewSession,
  Proof,
} from '@/types';

export function setAuthToken(token?: string) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem('illuvrse.authToken', token);
  else localStorage.removeItem('illuvrse.authToken');
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('illuvrse.authToken');
}

type RequestOptions = RequestInit & {
  idempotencyKey?: string;
  skipAuth?: boolean;
};

function resolveBaseUrl() {
  const envBase =
    process.env.NEXT_PUBLIC_MARKETPLACE_API_URL ||
    process.env.MARKETPLACE_API_URL ||
    '';
  return envBase.replace(/\/$/, '');
}

function buildUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = resolveBaseUrl();
  if (!base) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

async function request<T = any>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = buildUrl(path);
  const headers = new Headers(options.headers || {});

  if (!options.skipAuth) {
    const token = getAuthToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  if (
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: options.credentials ?? 'include',
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const errJson = await res.json();
      message =
        errJson?.error?.message ||
        errJson?.message ||
        JSON.stringify(errJson);
    } catch {
      try {
        message = await res.text();
      } catch {
        // ignore
      }
    }
    throw new Error(message || `Request failed (${res.status})`);
  }

  if (res.status === 204) return null as T;

  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function apiFetch(input: RequestInfo, init: RequestInit = {}) {
  return request(input as string, init);
}

function buildQuery(params: Record<string, any> = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function getCatalog(
  params: Record<string, any> = {}
): Promise<CatalogResponse> {
  return request(`/catalog${buildQuery(params)}`, { skipAuth: true });
}

async function getSku(skuId: string) {
  return request(`/sku/${encodeURIComponent(skuId)}`, { skipAuth: true });
}

async function startPreview(
  skuId: string,
  payload: Record<string, any> = {}
): Promise<PreviewSession> {
  const res = await request(`/sku/${encodeURIComponent(skuId)}/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return (res?.session || res) as PreviewSession;
}

async function postCheckout(
  payload: Record<string, any>,
  opts: { idempotencyKey?: string } = {}
) {
  return request('/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotencyKey: opts.idempotencyKey,
  });
}

async function postPaymentWebhook(payload: Record<string, any>) {
  return request('/webhooks/payment', {
    method: 'POST',
    body: JSON.stringify(payload),
    skipAuth: true,
  });
}

async function getOrder(orderId: string): Promise<{ order: OrderRecord }> {
  return request(`/order/${encodeURIComponent(orderId)}`);
}

async function getProof(proofId: string): Promise<{ proof: Proof }> {
  return request(`/proofs/${encodeURIComponent(proofId)}`);
}

async function getLicense(orderId: string) {
  return request(`/order/${encodeURIComponent(orderId)}/license`);
}

async function postLicenseVerify(
  license: any,
  expectedBuyerId?: string
): Promise<{ verified: boolean }> {
  return request('/license/verify', {
    method: 'POST',
    body: JSON.stringify({
      license,
      expected_buyer_id: expectedBuyerId,
    }),
  });
}

async function postSku(
  manifest: KernelManifest,
  catalogMetadata: Record<string, any>,
  operatorToken?: string
) {
  const headers: HeadersInit = {};
  if (operatorToken) headers['Authorization'] = `Bearer ${operatorToken}`;
  return request('/sku', {
    method: 'POST',
    body: JSON.stringify({
      manifest,
      catalog_metadata: catalogMetadata,
    }),
    headers,
  });
}

const api = {
  getCatalog,
  getSku,
  startPreview,
  postCheckout,
  postPaymentWebhook,
  getOrder,
  getProof,
  getLicense,
  postLicenseVerify,
  postSku,
};

export default api;
