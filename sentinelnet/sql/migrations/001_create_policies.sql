-- sentinelnet/sql/migrations/001_create_policies.sql
-- Create policies table for SentinelNet policy registry

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  rule JSONB NOT NULL,
  metadata JSONB,
  state TEXT NOT NULL CHECK (state IN ('draft','simulating','canary','active','deprecated')) DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep simple unique constraint per name+version so versions are explicit
CREATE UNIQUE INDEX IF NOT EXISTS policies_name_version_idx ON policies (name, version);

-- Index by state for quick lookups when running canaries or listing active policies
CREATE INDEX IF NOT EXISTS policies_state_idx ON policies (state);

-- Index on severity for queries that filter by high-severity policies
CREATE INDEX IF NOT EXISTS policies_severity_idx ON policies (severity);

-- Optional: small table for policy change history (audit of policy edits)
CREATE TABLE IF NOT EXISTS policy_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  changes JSONB,
  edited_by TEXT,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Basic function to update updated_at automatically on update (optional convenience)
CREATE OR REPLACE FUNCTION sentinel_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_updated_at ON policies;
CREATE TRIGGER trigger_set_updated_at
BEFORE UPDATE ON policies
FOR EACH ROW
EXECUTE PROCEDURE sentinel_set_updated_at();

