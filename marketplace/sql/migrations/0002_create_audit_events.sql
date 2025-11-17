-- 0002_create_audit_events.sql
-- Migration: create audit_events table used by marketplace/server/lib/auditWriter.ts
-- Save as marketplace/sql/migrations/0002_create_audit_events.sql
-- Run this against your marketplace Postgres database (psql or your migration runner).

BEGIN;

-- Create audit_events table
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL,
  hash TEXT NOT NULL,
  prev_hash TEXT NULL,
  signature TEXT NULL,
  signer_kid TEXT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure event chain hash integrity index and fast lookup by hash
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_hash ON audit_events (hash);

-- Index for fast range queries by created_at (used when exporting batches)
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at);

-- Optional: index by actor_id for operator queries
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_id ON audit_events (actor_id);

COMMIT;

