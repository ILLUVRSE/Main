/**
 * marketplace/ui/src/types/index.ts
 *
 * Shared TypeScript types used by the UI and API wrapper.
 * These mirror the JSON shapes emitted by the Marketplace backend.
 */

/* -----------------------------
 * Manifest / SKU related types
 * ----------------------------- */

export type ManifestSignature = {
  signer_kid: string;
  signature: string; // base64
  ts: string; // ISO timestamp
  id?: string; // optional manifestSignatureId
};

export type ManifestArtifact = {
  artifact_id: string;
  artifact_url: string; // s3:// or https://
  sha256?: string;
  metadata?: Record<string, any>;
};

export type ManifestAuthor = {
  id: string; // e.g., "actor:alice"
  name?: string;
};

export type ManifestLicense = {
  type: string; // e.g., 'single-user', 'enterprise'
  terms?: string;
  [k: string]: any;
};

export type KernelManifest = {
  id: string;
  title: string;
  version?: string;
  checksum?: string;
  author?: ManifestAuthor;
  license?: ManifestLicense;
  artifacts?: ManifestArtifact[];
  metadata?: Record<string, any>;
  manifest_signature?: ManifestSignature;
};

/* SKU exposed in lists */
export type SkuSummary = {
  sku_id: string;
  title: string;
  summary?: string;
  price: number; // in cents
  currency: string; // USD
  manifest_valid?: boolean;
  manifestSignatureId?: string;
  tags?: string[];
  author_id?: string;
  thumbnail?: string;
};

/* Full SKU detail */
export type SkuDetail = {
  sku_id: string;
  title: string;
  description?: string;
  price: number;
  currency: string;
  manifest?: KernelManifest | { manifest_signature_id?: string; manifest_valid?: boolean };
  manifest_metadata?: KernelManifest;
  manifest_signature_id?: string;
  manifest_valid?: boolean;
  tags?: string[];
  author_id?: string;
  created_at?: string;
};

/* Catalog response */
export type CatalogResponse = {
  ok: true;
  items: SkuSummary[];
  page: number;
  page_size: number;
  total: number;
};

/* -----------------------------
 * Preview session
 * ----------------------------- */

export type PreviewSession = {
  ok?: boolean;
  session_id?: string;
  endpoint?: string; // wss://...
  expires_at?: string; // ISO
};

/* -----------------------------
 * Orders, Payments, Deliveries
 * ----------------------------- */

export type OrderStatus = 'pending' | 'paid' | 'settled' | 'finalized' | 'failed';

export type Delivery = {
  delivery_id: string;
  status: string; // 'initiated' | 'ready' | 'failed'
  encrypted_delivery_url?: string;
  proof_id?: string;
  artifact_sha256?: string;
  manifest_signature_id?: string;
  ledger_proof_id?: string;
  signer_kid?: string;
  [k: string]: any;
};

export type License = {
  license_id: string;
  order_id?: string;
  sku_id?: string;
  buyer_id?: string;
  scope?: any; // e.g., { type: 'single-user', expires_at: '...' }
  issued_at?: string;
  signer_kid?: string;
  signature?: string; // base64
  canonical_payload?: any;
  [k: string]: any;
};

export type OrderRecord = {
  order_id: string;
  sku_id: string;
  buyer_id: string;
  amount: number; // cents
  currency: string;
  status: OrderStatus;
  created_at?: string;
  payment?: any;
  delivery?: Delivery;
  license?: License;
  ledger_proof_id?: string;
  [k: string]: any;
};

/* -----------------------------
 * Proofs & Artifact Publisher
 * ----------------------------- */

export type Proof = {
  proof_id: string;
  order_id?: string;
  artifact_sha256?: string;
  manifest_signature_id?: string;
  ledger_proof_id?: string;
  signer_kid?: string;
  signature?: string; // base64
  ts?: string;
  canonical_payload?: any;
  [k: string]: any;
};

/* -----------------------------
 * Finance / Ledger
 * ----------------------------- */

export type LedgerProof = {
  ledger_proof_id: string;
  signer_kid?: string;
  signature?: string; // base64
  ts?: string;
  payload?: any;
};

/* Journal / royalty split types */
export type RoyaltySplit = {
  recipient: string; // actor:alice
  amount: number; // cents
};

export type RoyaltiesResult = {
  totalRoyalties: number;
  splits: RoyaltySplit[];
};

/* -----------------------------
 * Audit events
 * ----------------------------- */

export type AuditEventIn = {
  actor_id?: string;
  event_type: string;
  payload: any;
  created_at?: string;
};

export type AuditRow = {
  id?: number;
  actor_id?: string;
  event_type?: string;
  payload?: any;
  hash?: string;
  prev_hash?: string | null;
  signature?: string | null;
  signer_kid?: string | null;
  created_at?: string;
};

/* -----------------------------
 * Misc / helpers
 * ----------------------------- */

export type ApiEnvelope<T = any> = {
  ok: boolean;
  error?: { code?: string; message?: string; details?: any } | null;
} & T;

