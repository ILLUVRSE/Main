-- kernel/sql/migrations/0001_init.sql
-- Minimal schema for Kernel runtime server (agents, allocations, manifests, manifest_signatures, audit_events).

BEGIN;

CREATE TABLE IF NOT EXISTS manifests (
  id TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manifest_signatures (
  id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL REFERENCES manifests(id),
  signer_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  hash TEXT,
  prev_hash TEXT,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  overrides JSONB,
  requester TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allocations (
  id TEXT PRIMARY KEY,
  division_id TEXT,
  entity_id TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  signature TEXT,
  signer_id TEXT,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_reports (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
