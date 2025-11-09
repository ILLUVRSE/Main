-- 0002_create_kernel_nonces.sql
-- Create kernel_nonces table used for replay protection of kernel callbacks.
-- Run with: psql "$DATABASE_URL" -f db/migrations/0002_create_kernel_nonces.sql

BEGIN;

-- Table to store observed kernel nonces (append-only-ish; nonce is unique).
CREATE TABLE IF NOT EXISTS kernel_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce TEXT NOT NULL UNIQUE,
  agent_id UUID REFERENCES agents(agent_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by TEXT
);

-- Helpful indexes for lookups and cleanup
CREATE INDEX IF NOT EXISTS idx_kernel_nonces_nonce ON kernel_nonces (nonce);
CREATE INDEX IF NOT EXISTS idx_kernel_nonces_expires_at ON kernel_nonces (expires_at);
CREATE INDEX IF NOT EXISTS idx_kernel_nonces_consumed_at ON kernel_nonces (consumed_at);

COMMIT;
