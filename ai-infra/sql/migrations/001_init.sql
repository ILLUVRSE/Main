-- ai-infra/sql/migrations/001_init.sql
-- Schema for training jobs, model artifacts, and promotion records.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_ref TEXT NOT NULL,
    container_digest TEXT NOT NULL,
    hyperparams JSONB NOT NULL DEFAULT '{}'::jsonb,
    dataset_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    seed BIGINT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    training_job_id UUID NOT NULL REFERENCES training_jobs(id) ON DELETE CASCADE,
    artifact_uri TEXT NOT NULL,
    checksum TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    signer_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    manifest_signature_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_id UUID NOT NULL REFERENCES model_artifacts(id) ON DELETE CASCADE,
    environment TEXT NOT NULL,
    status TEXT NOT NULL,
    evaluation JSONB NOT NULL DEFAULT '{}'::jsonb,
    sentinel_decision JSONB,
    promoted_by TEXT,
    promoted_at TIMESTAMPTZ,
    signature TEXT,
    signer_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS training_jobs_code_ref_idx ON training_jobs(code_ref);
CREATE INDEX IF NOT EXISTS model_artifacts_checksum_idx ON model_artifacts(checksum);
CREATE INDEX IF NOT EXISTS model_promotions_env_idx ON model_promotions(environment);

COMMIT;
