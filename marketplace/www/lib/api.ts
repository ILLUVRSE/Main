import { demoCatalog, demoModels, findDemoModelBySlug, getDemoOrderById } from "./mockData";
import {
  CartItem,
  CatalogResponse,
  CheckoutRequest,
  CheckoutSummary,
  MarketplaceModel,
  OrderRecord,
  PreviewRequest,
  PreviewSession,
} from "./types";

export interface CatalogQuery {
  search?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080";
const SANDBOX_WS = process.env.NEXT_PUBLIC_SANDBOX_WS ?? "ws://127.0.0.1:8081/preview";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchCatalog(params: CatalogQuery = {}): Promise<CatalogResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.category) query.set("category", params.category);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  try {
    const qs = query.toString();
    const target = qs ? `/api/catalog?${qs}` : "/api/catalog";
    const data = await requestJson<CatalogResponse>(target);
    return data;
  } catch (error) {
    console.warn("Falling back to demo catalog", error);
    const filtered = demoModels.filter((model) => {
      const matchesSearch = params.search
        ? model.title.toLowerCase().includes(params.search.toLowerCase()) ||
          model.tags.join(" ").toLowerCase().includes(params.search.toLowerCase())
        : true;
      const matchesCategory = params.category ? model.categories.includes(params.category) : true;
      return matchesSearch && matchesCategory;
    });

    return {
      ...demoCatalog,
      items: filtered,
      total: filtered.length,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? filtered.length,
    };
  }
}

export async function fetchSkuBySlug(slug: string): Promise<MarketplaceModel | null> {
  try {
    const data = await requestJson<MarketplaceModel>(`/api/sku/${slug}`);
    return data;
  } catch (error) {
    console.warn(`Falling back to demo SKU: ${slug}`, error);
    return findDemoModelBySlug(slug) ?? null;
  }
}

export async function requestPreviewSession(payload: PreviewRequest): Promise<PreviewSession> {
  try {
    const data = await requestJson<PreviewSession>(`/api/preview`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return data;
  } catch (error) {
    console.warn("Using deterministic local preview session", error);
    const sessionId = `demo_${payload.skuId}_${Date.now()}`;
    return {
      sessionId,
      wsUrl: `${SANDBOX_WS}?session_id=${sessionId}&sku=${payload.skuId}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }
}

export async function submitCheckout(payload: CheckoutRequest): Promise<CheckoutSummary> {
  const { deliveryPreferences, ...rest } = payload;
  const normalizedDelivery =
    deliveryPreferences.deliveryMode === "buyer_managed"
      ? {
          delivery_mode: "buyer_managed",
          key_metadata: deliveryPreferences.keyMetadata ?? { key_type: "rsa", format: "pem" },
          public_key: deliveryPreferences.publicKey,
        }
      : {
          delivery_mode: "marketplace_managed",
        };
  const checkoutBody = {
    ...rest,
    delivery_preferences: normalizedDelivery,
  };
  try {
    const data = await requestJson<CheckoutSummary>(`/api/checkout`, {
      method: "POST",
      body: JSON.stringify(checkoutBody),
    });
    return data;
  } catch (error) {
    console.warn("Falling back to offline checkout summary", error);
    const total = payload.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return {
      clientSecret: `demo_secret_${Date.now()}`,
      orderId: `ord_demo_${Date.now()}`,
      total,
      currency: payload.cart[0]?.currency ?? "USD",
    };
  }
}

export async function fetchOrderById(orderId: string): Promise<OrderRecord | null> {
  try {
    const data = await requestJson<OrderRecord>(`/api/order/${orderId}`);
    return data;
  } catch (error) {
    console.warn(`Falling back to demo order ${orderId}`, error);
    return getDemoOrderById(orderId) ?? null;
  }
}

export async function verifyDeliveryProof(proofId: string): Promise<{ verified: boolean; proofId: string }> {
  try {
    const data = await requestJson<{ verified: boolean; proofId: string }>(`/api/proofs/${proofId}`);
    return data;
  } catch (error) {
    console.warn(`Falling back to demo proof ${proofId}`, error);
    return { verified: !!getDemoOrderById("ord_demo_001"), proofId };
  }
}

export function computeCartTotals(cart: CartItem[]) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const fees = subtotal * 0.025;
  return {
    subtotal,
    fees,
    total: subtotal + fees,
  };
}
