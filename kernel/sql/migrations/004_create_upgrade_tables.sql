-- kernel/sql/migrations/004_create_upgrade_tables.sql
-- Create upgrade tracking tables (upgrades, upgrade_approvals) for 3-of-5 workflow.

BEGIN;

CREATE TABLE IF NOT EXISTS upgrades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upgrade_id VARCHAR NOT NULL UNIQUE,
  manifest JSONB NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'pending',
  submitted_by VARCHAR,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  applied_by VARCHAR,
  audit_event_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upgrades_status ON upgrades(status);
CREATE INDEX IF NOT EXISTS idx_upgrades_submitted_at ON upgrades(submitted_at DESC);

CREATE TABLE IF NOT EXISTS upgrade_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upgrade_id UUID NOT NULL REFERENCES upgrades(id) ON DELETE CASCADE,
  approver_id VARCHAR NOT NULL,
  signature TEXT NOT NULL,
  notes TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  audit_event_id UUID,
  UNIQUE (upgrade_id, approver_id)
);

CREATE INDEX IF NOT EXISTS idx_upgrade_approvals_upgrade ON upgrade_approvals(upgrade_id);
CREATE INDEX IF NOT EXISTS idx_upgrade_approvals_approver ON upgrade_approvals(approver_id);

COMMIT;
