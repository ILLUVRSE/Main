-- 005_add_agents_profile_column.sql
-- Ensure agents.profile JSON column exists for storing raw agent payloads.

ALTER TABLE IF EXISTS agents
  ADD COLUMN IF NOT EXISTS profile JSONB;

UPDATE agents
SET profile = COALESCE(profile, '{}'::jsonb)
WHERE profile IS NULL;

ALTER TABLE agents
  ALTER COLUMN profile SET DEFAULT '{}'::jsonb;

ALTER TABLE agents
  ALTER COLUMN profile SET NOT NULL;

