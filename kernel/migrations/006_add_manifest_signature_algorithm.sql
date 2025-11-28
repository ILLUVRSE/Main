-- kernel/migrations/006_add_manifest_signature_algorithm.sql
-- Mirror migration to add algorithm/key_version metadata to manifest_signatures.

ALTER TABLE IF EXISTS manifest_signatures
  ADD COLUMN IF NOT EXISTS algorithm TEXT,
  ADD COLUMN IF NOT EXISTS key_version TEXT;
