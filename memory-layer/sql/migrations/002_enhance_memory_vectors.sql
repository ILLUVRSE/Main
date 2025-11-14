-- memory-layer/sql/migrations/002_enhance_memory_vectors.sql
-- Adds vector payload + metadata columns and namespace constraints for Memory Layer embeddings.

BEGIN;

ALTER TABLE memory_vectors
  ADD COLUMN IF NOT EXISTS vector_data JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE memory_vectors
SET vector_data = COALESCE(vector_data, '[]'::jsonb);

ALTER TABLE memory_vectors
  ALTER COLUMN vector_data SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_vectors_node_namespace
  ON memory_vectors(memory_node_id, namespace);

COMMIT;
