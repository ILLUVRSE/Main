-- memory-layer/sql/migrations/003_create_reasoning_queue.sql
-- Create queue for asynchronous Reasoning Graph updates.

BEGIN;

CREATE TABLE IF NOT EXISTS reasoning_graph_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_node_id UUID NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  status VARCHAR NOT NULL DEFAULT 'pending',
  error TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reasoning_queue_status ON reasoning_graph_queue(status);
CREATE INDEX IF NOT EXISTS idx_reasoning_queue_node ON reasoning_graph_queue(memory_node_id);

COMMIT;
