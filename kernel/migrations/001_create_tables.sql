-- 0001_create_tables.sql
-- Initial schema for Kernel: divisions, agents, manifest_signatures, audit_events, eval_reports, allocations.

-- Ensure pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Divisions: store the DivisionManifest as jsonb
CREATE TABLE IF NOT EXISTS divisions (
  id text PRIMARY KEY,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_divisions_updated_at ON divisions (updated_at DESC);

-- Agents: authoritative runtime record (JSON profile)
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  profile jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents (created_at DESC);

-- Manifest signatures: records of manifest signing (base64 signature)
CREATE TABLE IF NOT EXISTS manifest_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id text NOT NULL,
  signer_id text NOT NULL,
  signature text NOT NULL,
  algorithm text,
  key_version text,
  version text,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manifest_signatures_manifest_id ON manifest_signatures (manifest_id);
CREATE INDEX IF NOT EXISTS idx_manifest_signatures_ts ON manifest_signatures (ts DESC);

-- Audit events: append-only events with hash/signature for chain integrity
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  prev_hash text,
  hash text NOT NULL,
  signature text NOT NULL,
  signer_id text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);

-- Indexes for fast queries and tailing
CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events (event_type);

-- Eval reports: minimal table storing metric_set jsonb
CREATE TABLE IF NOT EXISTS eval_reports (
  id text PRIMARY KEY,
  agent_id text NOT NULL,
  metric_set jsonb NOT NULL,
  timestamp timestamptz NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_agent_ts ON eval_reports (agent_id, timestamp DESC);

-- Allocations: compute/capital requests
CREATE TABLE IF NOT EXISTS allocations (
  id text PRIMARY KEY,
  division_id text NOT NULL,
  cpu integer,
  gpu integer,
  memory_mb integer,
  requester text,
  status text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_allocations_division ON allocations (division_id);
CREATE INDEX IF NOT EXISTS idx_allocations_status ON allocations (status);

-- Safety: prevent accidental updates that violate audit immutability - leave application-level enforcement.
-- End of migration.
