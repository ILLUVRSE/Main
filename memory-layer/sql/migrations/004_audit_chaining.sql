-- memory-layer/sql/migrations/004_audit_chaining.sql
-- Enforce audit chain linearity and add missing signer column.

BEGIN;

-- Add signer_id if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_events' AND column_name='signer_id') THEN
        ALTER TABLE audit_events ADD COLUMN signer_id VARCHAR;
    END IF;
END
$$;

-- Enforce linear chain
-- 1. Unique prev_hash (prevents branching)
-- Note: This might fail if there are duplicate prev_hashes (e.g. multiple NULLs).
-- If that happens, manual intervention is required to fix the chain.
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_prev_hash_unique ON audit_events(prev_hash);

-- 2. Only one genesis event (prev_hash IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_genesis_unique ON audit_events((prev_hash IS NULL)) WHERE prev_hash IS NULL;

COMMIT;
