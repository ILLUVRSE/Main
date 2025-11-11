-- 002_create_idempotency_table.sql
-- Create the idempotency table used by middleware to store request/response snapshots.

CREATE TABLE IF NOT EXISTS idempotency (
  key text PRIMARY KEY,
  request_hash text,
  request_body jsonb,
  response_status integer,
  response_body jsonb,
  response_headers jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  method text,
  path text
);

-- Index on expires_at so cleanup jobs can efficiently remove old entries.
CREATE INDEX IF NOT EXISTS idempotency_expires_at_idx ON idempotency (expires_at);

