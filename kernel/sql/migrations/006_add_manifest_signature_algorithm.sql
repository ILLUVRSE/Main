-- kernel/sql/migrations/006_add_manifest_signature_algorithm.sql
-- Adds algorithm + key_version columns to manifest_signatures for auditability.

ALTER TABLE IF EXISTS manifest_signatures
  ADD COLUMN IF NOT EXISTS algorithm TEXT,
  ADD COLUMN IF NOT EXISTS key_version TEXT;
