export type DeliveryMode = "marketplace_managed" | "buyer_managed";

export interface ModelVersion {
  id: string;
  label: string;
  sha: string;
  publishedAt: string;
  latencyMs: number;
  throughputTokensPerSecond: number;
  price: number;
  currency: string;
  supportsStreaming: boolean;
  changelog: string;
}

export interface ModelExample {
  id: string;
  input: string;
  output: string;
  createdAt: string;
}

export interface TrustSignal {
  id: string;
  label: string;
  description: string;
  evidenceUrl?: string;
  type: "security" | "compliance" | "license" | "uptime" | "audit" | "other";
}

export interface MarketplaceModel {
  id: string;
  slug: string;
  title: string;
  owner: string;
  shortDescription: string;
  longDescription: string;
  price: number;
  currency: string;
  rating: number;
  ratingCount: number;
  tags: string[];
  thumbnailUrl: string;
  categories: string[];
  updatedAt: string;
  verified: boolean;
  featured: boolean;
  latestReleaseNotes: string;
  versions: ModelVersion[];
  examples: ModelExample[];
  trustSignals: TrustSignal[];
}

export interface CatalogResponse {
  items: MarketplaceModel[];
  total: number;
  page: number;
  pageSize: number;
  categories: string[];
}

export interface PreviewRequest {
  skuId: string;
  input: string;
  versionId?: string;
  temperature?: number;
}

export interface PreviewSession {
  sessionId: string;
  wsUrl: string;
  expiresAt: string;
}

export interface CheckoutBuyer {
  name: string;
  email: string;
  company?: string;
  notes?: string;
}

export interface CartItem {
  skuId: string;
  slug: string;
  modelTitle: string;
  price: number;
  currency: string;
  quantity: number;
  versionId: string;
  versionLabel: string;
  deliveryMode: DeliveryMode;
}

export interface CartItemInput extends Omit<CartItem, "quantity"> {
  quantity?: number;
}

export interface DeliveryPreferences {
  deliveryMode: DeliveryMode;
  buyerManagedKeyPem?: string;
  keyMetadata?: {
    keyType: string;
    format: string;
    fingerprint?: string;
  };
}

export interface CheckoutRequest {
  cart: CartItem[];
  buyer: CheckoutBuyer;
  deliveryPreferences: DeliveryPreferences;
}

export interface CheckoutSummary {
  clientSecret: string;
  orderId: string;
  total: number;
  currency: string;
}

export interface OrderItem {
  skuId: string;
  slug: string;
  modelTitle: string;
  versionLabel: string;
  price: number;
  currency: string;
}

export interface DeliveryProof {
  id: string;
  createdAt: string;
  evidenceHash: string;
  merkleRoot: string;
  notarizationUrl?: string;
  courierSignature?: string;
  notes?: string;
}

export interface LicenseDocument {
  name: string;
  body: string;
  effectiveAt: string;
  expiresAt?: string;
}

export interface OrderRecord {
  id: string;
  status: "processing" | "fulfilled" | "delivered" | "failed";
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  total: number;
  currency: string;
  license: LicenseDocument;
  delivery: {
    mode: DeliveryMode;
    keyMetadata?: DeliveryPreferences["keyMetadata"];
    buyerManagedKeyPem?: string;
    fulfillmentEta?: string;
  };
  proof: DeliveryProof;
}
