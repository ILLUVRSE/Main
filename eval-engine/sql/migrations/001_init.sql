-- eval-engine/sql/migrations/001_init.sql
-- Schema for Eval Engine ingestion and Resource Allocator.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS eval_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    metric_set JSONB NOT NULL,
    source TEXT,
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    ts TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_scores (
    agent_id TEXT PRIMARY KEY,
    score DOUBLE PRECISION NOT NULL,
    components JSONB NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    window TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promotion_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    action TEXT NOT NULL,
    rationale TEXT,
    confidence DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL,
    requested_by TEXT,
    allocation_request_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS allocation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID,
    agent_id TEXT NOT NULL,
    pool TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT,
    status TEXT NOT NULL,
    sentinel_decision JSONB,
    requested_by TEXT,
    applied_by TEXT,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eval_reports_agent_idx ON eval_reports(agent_id);
CREATE INDEX IF NOT EXISTS promotion_events_agent_idx ON promotion_events(agent_id);
CREATE INDEX IF NOT EXISTS allocation_requests_agent_idx ON allocation_requests(agent_id);

COMMIT;
