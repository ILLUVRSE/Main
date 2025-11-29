-- Enforce audit chain integrity
-- 1. Ensure only one genesis event (prev_hash IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_genesis ON audit_events ((prev_hash IS NULL)) WHERE prev_hash IS NULL;

-- 2. Ensure linear chain (no forks): prev_hash must be unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_prev_hash_unique ON audit_events (prev_hash);
