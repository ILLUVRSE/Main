-- kernel/migrations/007_create_multisig_tables.sql

BEGIN;

CREATE TABLE IF NOT EXISTS multisig_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id VARCHAR NOT NULL UNIQUE, -- Human readable or external ID
  proposer_id VARCHAR NOT NULL,
  payload JSONB NOT NULL,
  required_threshold INTEGER NOT NULL DEFAULT 3,
  signer_set JSONB NOT NULL, -- Array of allowed signer IDs
  status VARCHAR NOT NULL DEFAULT 'proposed', -- proposed, approved, applied, rejected, ratified
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_multisig_proposals_status ON multisig_proposals(status);
CREATE INDEX IF NOT EXISTS idx_multisig_proposals_created_at ON multisig_proposals(created_at DESC);

CREATE TABLE IF NOT EXISTS multisig_signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id VARCHAR NOT NULL UNIQUE, -- e.g. "signer-1" or email
  public_key TEXT, -- PEM or similar
  role VARCHAR NOT NULL DEFAULT 'signer', -- signer, ratifier
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS multisig_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES multisig_proposals(id) ON DELETE CASCADE,
  signer_id VARCHAR NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (proposal_id, signer_id)
);

CREATE INDEX IF NOT EXISTS idx_multisig_approvals_proposal ON multisig_approvals(proposal_id);
CREATE INDEX IF NOT EXISTS idx_multisig_approvals_signer ON multisig_approvals(signer_id);

COMMIT;
