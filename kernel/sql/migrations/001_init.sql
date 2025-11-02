-- kernel/sql/migrations/001_init.sql
-- Initial Postgres schema for Kernel module (divisions, agents, eval_reports,
-- memory_nodes, manifest_signatures, audit_events, resource_allocations).
-- NOTE: This migration is intended for local/dev and CI runs. In production,
-- run migrations using your chosen migration tool and ensure extensions exist.
--
-- DO NOT COMMIT SECRETS — use Vault/KMS and environment variables for keys.

BEGIN;

-- Provide UUID generator (pgcrypto -> gen_random_uuid). Requires appropriate privileges.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------
-- Manifest signatures table
-- -------------------------
CREATE TABLE IF NOT EXISTS manifest_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id VARCHAR NOT NULL,
  signer_id VARCHAR NOT NULL,
  signature TEXT NOT NULL,
  version VARCHAR,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_manifest_signatures_manifest_id ON manifest_signatures(manifest_id);

-- -------------------------
-- Audit events (append-only)
-- -------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR NOT NULL,
  payload JSONB NOT NULL,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  signature TEXT,
  signer_id VARCHAR,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events(ts);
CREATE INDEX IF NOT EXISTS idx_audit_events_hash ON audit_events(hash);

-- -------------------------
-- Divisions (DivisionManifest)
-- -------------------------
CREATE TABLE IF NOT EXISTS divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR,
  goals JSONB DEFAULT '[]'::jsonb,
  budget NUMERIC DEFAULT 0,
  currency VARCHAR DEFAULT 'USD',
  kpis JSONB DEFAULT '[]'::jsonb,
  policies JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  status VARCHAR DEFAULT 'active',
  version VARCHAR,
  manifest_signature_id UUID REFERENCES manifest_signatures(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_divisions_status ON divisions(status);
CREATE INDEX IF NOT EXISTS idx_divisions_manifest_sig_id ON divisions(manifest_signature_id);

-- -------------------------
-- Agents (AgentProfile)
-- -------------------------
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id VARCHAR,
  role VARCHAR,
  skills JSONB DEFAULT '[]'::jsonb,
  code_ref VARCHAR,
  division_id UUID REFERENCES divisions(id) ON DELETE SET NULL,
  state VARCHAR DEFAULT 'stopped',
  score NUMERIC DEFAULT 0,
  resource_allocation JSONB DEFAULT '{}'::jsonb,
  last_heartbeat TIMESTAMPTZ,
  owner VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_division_id ON agents(division_id);
CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state);
CREATE INDEX IF NOT EXISTS idx_agents_last_heartbeat ON agents(last_heartbeat);

-- -------------------------
-- Eval reports (EvalReport)
-- -------------------------
CREATE TABLE IF NOT EXISTS eval_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  metric_set JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  source VARCHAR,
  computed_score NUMERIC,
  "window" VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_evals_agent_ts ON eval_reports(agent_id, timestamp DESC);

-- -------------------------
-- Memory nodes
-- -------------------------
CREATE TABLE IF NOT EXISTS memory_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT,
  embedding_id VARCHAR, -- vector DB id
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_created_at ON memory_nodes(created_at);

-- -------------------------
-- Resource allocations
-- -------------------------
CREATE TABLE IF NOT EXISTS resource_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id VARCHAR NOT NULL, -- agentId or divisionId (string)
  pool VARCHAR,
  delta NUMERIC,
  reason TEXT,
  requested_by VARCHAR,
  status VARCHAR DEFAULT 'pending',
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alloc_entity_id ON resource_allocations(entity_id);
CREATE INDEX IF NOT EXISTS idx_alloc_status ON resource_allocations(status);

-- -------------------------
-- Basic governance helpers (optional)
-- -------------------------
-- A table to store lightweight key/value runtime settings for Kernel (e.g., head-of-audit).
CREATE TABLE IF NOT EXISTS kernel_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;

-- -------------------------
-- Acceptance Criteria (testable)
-- -------------------------
-- 1) All required tables exist: manifest_signatures, audit_events, divisions,
--    agents, eval_reports, memory_nodes, resource_allocations.
--    Test: \dt in psql or query information_schema.tables for these names.
--
-- 2) Columns match data-models.md expectations:
--    - UUID PKs where appropriate (default gen_random_uuid()).
--    - JSONB for flexible fields (goals, kpis, policies, metadata, skills, metric_set).
--    Test: SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'divisions';
--
-- 3) Foreign keys exist:
--    - divisions.manifest_signature_id -> manifest_signatures.id
--    - agents.division_id -> divisions.id
--    - eval_reports.agent_id -> agents.id
--    Test: Verify with pg_constraint / information_schema.
--
-- 4) Indexes for common queries:
--    - agents by division_id, state, last_heartbeat
--    - eval_reports by agent_id + timestamp
--    - audit_events by ts
--    Test: \di in psql or query pg_indexes.
--
-- 5) Append-only storage principle for audit_events:
--    - While this SQL doesn't add triggers to prevent deletes/updates, audit_events
--      should be treated as append-only by application logic.
--    Test: Create audit_events rows via application and validate prev_hash/hash fields are populated.
--
-- 6) Migration idempotency:
--    - Running this migration twice must not fail.
--    Test: Execute the script twice: second run shouldn't error and should leave schema intact.

