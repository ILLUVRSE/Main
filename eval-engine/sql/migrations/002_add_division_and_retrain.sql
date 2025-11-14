-- eval-engine/sql/migrations/002_add_division_and_retrain.sql
-- Adds division metadata to agent_scores and introduces retrain_jobs table.

BEGIN;

ALTER TABLE agent_scores
    ADD COLUMN IF NOT EXISTS division_id TEXT;

CREATE INDEX IF NOT EXISTS agent_scores_division_idx ON agent_scores(division_id);

CREATE TABLE IF NOT EXISTS retrain_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_family TEXT NOT NULL,
    dataset_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_by TEXT,
    allocation_request_id UUID,
    result_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS retrain_jobs_model_priority_idx ON retrain_jobs(model_family, priority);

COMMIT;
