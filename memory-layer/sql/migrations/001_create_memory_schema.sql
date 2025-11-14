-- memory-layer/sql/migrations/001_create_memory_schema.sql
-- Canonical schema for Memory Layer metadata, artifacts, vectors, and audit events.
-- Apply in every environment before deploying the Memory Layer service.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS memory_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner VARCHAR NOT NULL,
  embedding_id VARCHAR UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  pii_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  legal_hold_reason TEXT,
  ttl_seconds INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_owner ON memory_nodes(owner);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_expires_at ON memory_nodes(expires_at);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_deleted_at ON memory_nodes(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS memory_vectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_node_id UUID NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  provider VARCHAR NOT NULL,
  namespace VARCHAR NOT NULL,
  embedding_model VARCHAR NOT NULL,
  dimension INTEGER NOT NULL,
  external_vector_id VARCHAR,
  status VARCHAR NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_vectors_node ON memory_vectors(memory_node_id);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_status ON memory_vectors(status);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_node_id UUID REFERENCES memory_nodes(id) ON DELETE SET NULL,
  artifact_url TEXT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  manifest_signature_id VARCHAR,
  size_bytes BIGINT,
  created_by VARCHAR,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_sha256_length CHECK (char_length(sha256) = 64)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_url_sha ON artifacts(artifact_url, sha256);
CREATE INDEX IF NOT EXISTS idx_artifacts_memory_node ON artifacts(memory_node_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR NOT NULL,
  memory_node_id UUID REFERENCES memory_nodes(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  hash TEXT NOT NULL,
  prev_hash TEXT,
  signature TEXT,
  manifest_signature_id VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_node ON audit_events(memory_node_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_artifact ON audit_events(artifact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_hash ON audit_events(hash);

COMMIT;
