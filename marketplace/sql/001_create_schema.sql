-- 001_create_schema.sql
-- Initial schema for the ILLUVRSE Marketplace
-- Target: PostgreSQL (uses pgcrypto for gen_random_uuid)
-- Intended for dev/staging/production DB migrations.

-- Enable uuid generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

---------------------------------------------------------------------
-- Users
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_active_idx ON users (active);

---------------------------------------------------------------------
-- Sessions (tokens)
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

---------------------------------------------------------------------
-- Listings
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC(18,4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  visibility TEXT NOT NULL DEFAULT 'private', -- public | private | unlisted
  status TEXT NOT NULL DEFAULT 'pending', -- pending | published | rejected | archived
  metadata JSONB DEFAULT '{}'::JSONB,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS listings_author_idx ON listings (author_id);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (status);
CREATE INDEX IF NOT EXISTS listings_visibility_idx ON listings (visibility);
CREATE INDEX IF NOT EXISTS listings_price_idx ON listings (price);
CREATE INDEX IF NOT EXISTS listings_tags_gin ON listings USING GIN (tags);
CREATE INDEX IF NOT EXISTS listings_title_trgm ON listings USING gin (to_tsvector('english', title || ' ' || coalesce(description, '')));

---------------------------------------------------------------------
-- Listing files (separate table for files)
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT, -- filesystem path
  url TEXT,  -- external URL
  size BIGINT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_files_listing_idx ON listing_files (listing_id);

---------------------------------------------------------------------
-- Payments / Refunds / Payouts / Entitlements
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending', -- pending|requires_action|succeeded|failed|cancelled|completed|refunded
  provider TEXT,
  provider_charge_id TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  history JSONB DEFAULT '[]'::JSONB
);

CREATE INDEX IF NOT EXISTS payments_buyer_idx ON payments (buyer_id);
CREATE INDEX IF NOT EXISTS payments_seller_idx ON payments (seller_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE INDEX IF NOT EXISTS payments_provider_charge_idx ON payments (provider, provider_charge_id);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount NUMERIC(18,4),
  currency TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|succeeded|failed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds (payment_id);

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE SET NULL,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  method TEXT,
  destination TEXT,
  status TEXT NOT NULL DEFAULT 'requested', -- requested|paid|failed|cancelled
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payouts_seller_idx ON payouts (seller_id);
CREATE INDEX IF NOT EXISTS payouts_payment_idx ON payouts (payment_id);

CREATE TABLE IF NOT EXISTS download_entitlements (
  token TEXT PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entitlements_user_idx ON download_entitlements (user_id);
CREATE INDEX IF NOT EXISTS entitlements_expires_idx ON download_entitlements (expires_at);

---------------------------------------------------------------------
-- Integrations
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  config JSONB DEFAULT '{}'::JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integrations_kind_idx ON integrations (lower(kind));
CREATE INDEX IF NOT EXISTS integrations_name_idx ON integrations (lower(name));

---------------------------------------------------------------------
-- Jobs (background queue)
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::JSONB,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|running|succeeded|failed|cancelled
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  history JSONB DEFAULT '[]'::JSONB,
  logs JSONB DEFAULT '[]'::JSONB,
  initiated_by TEXT
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_priority_idx ON jobs (priority);

---------------------------------------------------------------------
-- Audit events
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audits_action_idx ON audits (action);
CREATE INDEX IF NOT EXISTS audits_actor_idx ON audits (actor);
CREATE INDEX IF NOT EXISTS audits_created_idx ON audits (created_at);

---------------------------------------------------------------------
-- Settings (simple key/value)
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed some minimal settings if they do not exist
INSERT INTO settings (key, value)
SELECT 'app', '{"name":"ILLUVRSE Marketplace","env":"development"}'::JSONB
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'app');

INSERT INTO settings (key, value)
SELECT 'admin', '{"apiKey": null}'::JSONB
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'admin');

---------------------------------------------------------------------
-- Misc utilities
---------------------------------------------------------------------
-- Update updated_at triggers for tables that benefit from it
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_listings'
  ) THEN
    CREATE TRIGGER set_updated_at_listings BEFORE UPDATE ON listings FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_payments'
  ) THEN
    CREATE TRIGGER set_updated_at_payments BEFORE UPDATE ON payments FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_integrations'
  ) THEN
    CREATE TRIGGER set_updated_at_integrations BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_payouts'
  ) THEN
    CREATE TRIGGER set_updated_at_payouts BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_jobs'
  ) THEN
    CREATE TRIGGER set_updated_at_jobs BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
  END IF;
END;
$$;

---------------------------------------------------------------------
-- End of migration
---------------------------------------------------------------------

