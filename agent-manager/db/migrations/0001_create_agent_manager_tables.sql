-- 0001_create_agent_manager_tables.sql
-- Create core tables for Agent Manager (Postgres)
-- Run with: psql "$DATABASE_URL" -f db/migrations/0001_create_agent_manager_tables.sql

BEGIN;

-- UUID helper. Use pgcrypto's gen_random_uuid() if available.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  agent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT,
  created_at timestamptz NOT NULL DEFAULT now(),
  latest_manifest JSONB,
  metadata JSONB,
  last_seen timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);
CREATE INDEX IF NOT EXISTS idx_agents_created_by ON agents (created_by);
CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents (last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_agents_metadata_gin ON agents USING gin (metadata);

-- Templates table
CREATE TABLE IF NOT EXISTS templates (
  template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure template names are unique to simplify lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_name_unique ON templates (lower(name));

-- Sandbox runs table
CREATE TABLE IF NOT EXISTS sandbox_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(agent_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  logs TEXT,
  test_results JSONB,
  artifacts JSONB,
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sandbox_runs_agent ON sandbox_runs (agent_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_status ON sandbox_runs (status);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_started_at ON sandbox_runs (started_at DESC);

-- Audit events (append-only)
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB,
  signature TEXT,     -- stored signature for this audit event (base64 or hex)
  signer_kid TEXT,    -- key id used to sign
  prev_hash TEXT,     -- optional previous event hash to form a chain
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at DESC);

-- Lightweight metadata table (optional) for configuration / counters
CREATE TABLE IF NOT EXISTS am_metadata (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

