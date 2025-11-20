-- 0003_delivery_modes.sql
-- Adds delivery mode & key metadata columns to orders for encryption tracking.

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT,
  ADD COLUMN IF NOT EXISTS delivery_preferences JSONB,
  ADD COLUMN IF NOT EXISTS order_metadata JSONB,
  ADD COLUMN IF NOT EXISTS key_metadata JSONB;

COMMIT;
