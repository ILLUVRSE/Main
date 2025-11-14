-- Canonical Finance schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS accounts (
  account_id VARCHAR(64) PRIMARY KEY,
  ledger_id VARCHAR(64) NOT NULL,
  type VARCHAR(16) NOT NULL,
  name TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  journal_id UUID PRIMARY KEY,
  batch_id UUID NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  currency CHAR(3) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS journal_lines (
  line_id BIGSERIAL PRIMARY KEY,
  journal_id UUID REFERENCES journal_entries(journal_id) ON DELETE CASCADE,
  account_id VARCHAR(64) REFERENCES accounts(account_id),
  direction VARCHAR(8) NOT NULL,
  amount_cents BIGINT NOT NULL,
  memo TEXT
);

CREATE TABLE IF NOT EXISTS payouts (
  payout_id UUID PRIMARY KEY,
  invoice_id VARCHAR(64),
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  destination JSONB NOT NULL,
  memo TEXT,
  requested_by TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  provider_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payout_approvals (
  approval_id BIGSERIAL PRIMARY KEY,
  payout_id UUID REFERENCES payouts(payout_id) ON DELETE CASCADE,
  approver TEXT NOT NULL,
  role TEXT NOT NULL,
  signature TEXT NOT NULL,
  comment TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  subject_id TEXT,
  actor TEXT NOT NULL,
  role TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proof_manifest (
  proof_id UUID PRIMARY KEY,
  range_from TIMESTAMPTZ NOT NULL,
  range_to TIMESTAMPTZ NOT NULL,
  manifest JSONB NOT NULL,
  manifest_hash TEXT NOT NULL,
  root_hash TEXT NOT NULL,
  s3_object_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) REFERENCES accounts(account_id),
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  status VARCHAR(16) NOT NULL,
  due_date DATE,
  metadata JSONB DEFAULT '{}'::jsonb
);
