/**
 * marketplace/ui/src/lib/api.ts
 *
 * Small typed wrapper around the Marketplace HTTP API.
 * - Normalizes the { ok: boolean, ... } envelope used by the backend.
 * - Adds convenient helpers for idempotency keys and Authorization header.
 *
 * NOTE: This file intentionally uses `any` for payloads where backend types
 * will be provided by a later `types/` module. Replace `any` with concrete types
 * as you add the shared type files.
 */

const BASE = process.env.NEXT_PUBLIC_MARKETPLACE_BASE_URL || 'http://127.0.0.1:3000';

let authToken: string | null = null;

/** Set Authorization token for subsequent requests (Bearer token) */
export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Small helper to build query strings */
function qs(params: Record<string, any> = {}) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) =>
      Array.isArray(v)
        ? `${encodeURIComponent(k)}=${encodeURIComponent(v.join(','))}`
        : `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
    );
  return entries.length ? `?${entries.join('&')}` : '';
}

/** Generic JSON request helper */
async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers ? (opts.headers as Record<string, string>) : {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${BASE.replace(/\/$/, '')}${path}`, {
    ...opts,
    headers,
  });

  const text = await res.text();

  // Try parse JSON, otherwise return text when appropriate
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!res.ok) {
    const message =
      (payload && payload.error && payload.error.message) ||
      (payload && payload.message) ||
      res.statusText ||
      'Request failed';
    const err: any = new Error(message);
    err.status = res.status;
    err.body = payload;
    throw err;
  }

  // If backend uses { ok: boolean, ... } envelope, normalize it
  if (payload && typeof payload === 'object' && 'ok' in payload) {
    if (payload.ok === true) {
      // Return the full payload (caller can pick fields) but prefer common fields
      return payload as T;
    } else {
      const message =
        (payload.error && payload.error.message) ||
        payload.message ||
        'Server returned ok:false';
      const err: any = new Error(message);
      err.status = res.status;
      err.body = payload;
      throw err;
    }
  }

  // Fallback: return parsed payload or raw text
  return (payload as T) || (text as unknown as T);
}

/* -------------------------
   API convenience functions
   -------------------------*/

/** GET /catalog */
export async function getCatalog(opts?: {
  page?: number;
  page_size?: number;
  query?: string;
  tags?: string[] | string;
  author?: string;
}) {
  const { page = 1, page_size = 20, query, tags, author } = opts || {};
  const params: any = { page, page_size: page_size, query, author };
  if (tags) params.tags = Array.isArray(tags) ? tags.join(',') : tags;
  return request<{ ok: true; items: any[]; page: number; page_size: number; total: number }>(
    `/catalog${qs(params)}`
  );
}

/** GET /sku/{sku_id} */
export async function getSku(skuId: string) {
  if (!skuId) throw new Error('skuId required');
  return request<{ ok: true; sku: any }>(`/sku/${encodeURIComponent(skuId)}`);
}

/** POST /sku/{sku_id}/preview */
export async function postPreview(skuId: string, body?: { expires_in_seconds?: number; session_metadata?: any }) {
  if (!skuId) throw new Error('skuId required');
  return request<{ ok: true; session_id?: string; endpoint?: string; expires_at?: string }>(
    `/sku/${encodeURIComponent(skuId)}/preview`,
    {
      method: 'POST',
      body: JSON.stringify({
        sku_id: skuId,
        expires_in_seconds: body?.expires_in_seconds ?? 900,
        session_metadata: body?.session_metadata ?? {},
      }),
    }
  );
}

/** POST /checkout */
export async function postCheckout(
  payload: any,
  options?: { idempotencyKey?: string; token?: string }
) {
  const headers: Record<string, string> = {};
  if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options?.token) headers['Authorization'] = `Bearer ${options.token}`;

  return request<{ ok: true; order: any }>(`/checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

/** GET /order/{order_id} */
export async function getOrder(orderId: string) {
  if (!orderId) throw new Error('orderId required');
  return request<{ ok: true; order: any }>(`/order/${encodeURIComponent(orderId)}`);
}

/** POST /order/{order_id}/finalize (server-side use) */
export async function postFinalize(orderId: string, body: any) {
  if (!orderId) throw new Error('orderId required');
  return request<{ ok: true; order?: any }>(`/order/${encodeURIComponent(orderId)}/finalize`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /webhooks/payment (for testing local webhooks) */
export async function postPaymentWebhook(body: any) {
  return request<{ ok: true }>(`/webhooks/payment`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** GET /proofs/{proof_id} */
export async function getProof(proofId: string) {
  if (!proofId) throw new Error('proofId required');
  return request<{ ok: true; proof: any }>(`/proofs/${encodeURIComponent(proofId)}`);
}

/** POST /license/verify */
export async function postLicenseVerify(licenseObj: any, expectedBuyerId?: string) {
  const payload: any = { license: licenseObj };
  if (expectedBuyerId) payload.expected_buyer_id = expectedBuyerId;
  return request<{ ok: true; verified: boolean; details?: any }>(`/license/verify`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Admin: POST /sku (register SKU) - operator token required */
export async function postSku(manifest: any, catalogMetadata: any = {}, operatorToken?: string) {
  const headers: Record<string, string> = {};
  if (operatorToken) headers['Authorization'] = `Bearer ${operatorToken}`;
  return request<{ ok: true; sku_id: string; manifestSignatureId?: string }>(`/sku`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ manifest, catalog_metadata: catalogMetadata }),
  });
}

/** Admin: GET /catalog (admin convenience) - wrapper for getCatalog */
export async function adminGetCatalog(page = 1, page_size = 50) {
  return getCatalog({ page, page_size });
}

/* Export a default collection for convenience */
const API = {
  setAuthToken,
  getCatalog,
  getSku,
  postPreview,
  postCheckout,
  getOrder,
  postFinalize,
  postPaymentWebhook,
  getProof,
  postLicenseVerify,
  postSku,
  adminGetCatalog,
};

export default API;

