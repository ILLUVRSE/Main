-- kernel/sql/migrations/002_audit_sampling.sql
ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS sampled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_audit_events_retention ON audit_events(retention_expires_at);
