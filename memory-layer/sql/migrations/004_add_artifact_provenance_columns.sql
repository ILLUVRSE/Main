-- memory-layer/sql/migrations/004_add_artifact_provenance_columns.sql
-- Add provenance-related columns to artifacts table.

BEGIN;

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS s3_key TEXT,
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS storage_class TEXT,
  ADD COLUMN IF NOT EXISTS provenance_verified BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_artifacts_provenance_verified ON artifacts(provenance_verified);

COMMIT;
