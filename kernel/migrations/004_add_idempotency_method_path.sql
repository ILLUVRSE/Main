-- 004_add_idempotency_method_path.sql
-- Ensure idempotency table has method and path columns required by middleware

BEGIN;

ALTER TABLE idempotency
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS path text;

COMMIT;

