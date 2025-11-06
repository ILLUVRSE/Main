ALTER TABLE idempotency
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE idempotency
  SET expires_at = COALESCE(expires_at, created_at + INTERVAL '1 day');

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency (expires_at);
