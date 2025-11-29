-- memory-layer/sql/migrations/004_add_processed_requests.sql
-- Add processed_requests table for idempotency checks.

BEGIN;

CREATE TABLE IF NOT EXISTS processed_requests (
  request_id VARCHAR PRIMARY KEY,
  memory_node_id UUID REFERENCES memory_nodes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
