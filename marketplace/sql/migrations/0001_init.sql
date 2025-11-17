-- 0001_init.sql
-- Initial Marketplace schema
-- Tables: skus, orders, proofs, licenses, preview_sessions, audit_events, royalties

BEGIN;

-- SKUs
CREATE TABLE IF NOT EXISTS skus (
  sku_id              TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  summary             TEXT,
  price               BIGINT DEFAULT 0,          -- price in smallest unit (cents)
  currency            TEXT DEFAULT 'USD',
  manifest_metadata   JSONB,                     -- kernel-signed manifest or manifest metadata
  manifest_signature_id TEXT,                    -- reference to manifest signature id
  manifest_valid      BOOLEAN DEFAULT FALSE,
  tags                TEXT[],                    -- categories/tags
  author_id           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast tag/author lookups
CREATE INDEX IF NOT EXISTS idx_skus_tags ON skus USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_skus_author ON skus (author_id);
CREATE INDEX IF NOT EXISTS idx_skus_title ON skus (lower(title));

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  order_id            TEXT PRIMARY KEY,
  sku_id              TEXT NOT NULL,
  buyer_id            TEXT NOT NULL,
  amount              BIGINT DEFAULT 0,
  currency            TEXT DEFAULT 'USD',
  status              TEXT NOT NULL,            -- pending | paid | settled | finalized | failed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment             JSONB,                    -- payment provider payload / metadata
  delivery            JSONB,                    -- delivery object (encrypted URL, proof_id, etc.)
  license             JSONB,                    -- signed license object
  ledger_proof_id     TEXT,                     -- finance ledger proof id (if any)
  CONSTRAINT fk_orders_sku FOREIGN KEY (sku_id) REFERENCES skus (sku_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders (buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);

-- Proofs (delivery proofs)
CREATE TABLE IF NOT EXISTS proofs (
  proof_id            TEXT PRIMARY KEY,
  order_id            TEXT,
  artifact_sha256     TEXT,
  manifest_signature_id TEXT,
  ledger_proof_id     TEXT,
  signer_kid          TEXT,
  signature           TEXT,                     -- base64 signature
  canonical_payload   JSONB,
  ts                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proofs_order ON proofs (order_id);
CREATE INDEX IF NOT EXISTS idx_proofs_artifact ON proofs (artifact_sha256);

-- Licenses (explicit table for easy lookup & filtering)
CREATE TABLE IF NOT EXISTS licenses (
  license_id          TEXT PRIMARY KEY,
  order_id            TEXT,
  sku_id              TEXT,
  buyer_id            TEXT,
  scope               JSONB,                    -- license scope, limits, expiry etc.
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  signer_kid          TEXT,
  signature           TEXT,                     -- base64 signed license
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_licenses_order ON licenses (order_id);
CREATE INDEX IF NOT EXISTS idx_licenses_buyer ON licenses (buyer_id);

-- Preview / Sandbox sessions
CREATE TABLE IF NOT EXISTS preview_sessions (
  session_id          TEXT PRIMARY KEY,
  sku_id              TEXT,
  endpoint            TEXT,
  started_at          TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  status              TEXT,                     -- running | expired | failed | completed
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preview_sessions_sku ON preview_sessions (sku_id);
CREATE INDEX IF NOT EXISTS idx_preview_sessions_expires ON preview_sessions (expires_at);

-- Audit events (append-only)
CREATE TABLE IF NOT EXISTS audit_events (
  id                  BIGSERIAL PRIMARY KEY,
  actor_id            TEXT,
  event_type          TEXT NOT NULL,
  payload             JSONB NOT NULL,           -- canonicalized payload
  hash                TEXT,                     -- sha256 hex of (canonical(payload) || prevHash)
  prev_hash           TEXT,
  signature           TEXT,                     -- base64 signature (if persisted)
  signer_kid          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at);

-- Royalties (simple representation for SKU-level royalty rules)
CREATE TABLE IF NOT EXISTS royalties (
  id                  BIGSERIAL PRIMARY KEY,
  sku_id              TEXT NOT NULL,
  rule                JSONB NOT NULL,           -- royalty rule (percentages, recipients)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_royalties_sku ON royalties (sku_id);

-- Optional: light-weight journaling table (if marketplace wants local journal entries)
CREATE TABLE IF NOT EXISTS marketplace_journal (
  journal_id          TEXT PRIMARY KEY,
  batch_id            TEXT,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT now(),
  currency            TEXT,
  lines               JSONB,                    -- array of { accountId, direction, amount }
  metadata            JSONB
);

CREATE INDEX IF NOT EXISTS idx_journal_batch ON marketplace_journal (batch_id);

-- Convenience view: order_with_license_delivery (optional)
CREATE VIEW IF NOT EXISTS order_with_license_delivery AS
SELECT
  o.order_id,
  o.sku_id,
  o.buyer_id,
  o.amount,
  o.currency,
  o.status,
  o.created_at,
  o.payment,
  o.delivery,
  o.license,
  l.license_id AS license_record_id,
  p.proof_id AS proof_record_id
FROM orders o
LEFT JOIN licenses l ON l.order_id = o.order_id
LEFT JOIN proofs p ON p.order_id = o.order_id;

COMMIT;

