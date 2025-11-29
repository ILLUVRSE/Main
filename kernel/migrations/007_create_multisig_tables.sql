CREATE TABLE IF NOT EXISTS multisig_signers (
    id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL, -- PEM or Base64 encoded public key
    role TEXT NOT NULL DEFAULT 'signer', -- signer, admin
    status TEXT NOT NULL DEFAULT 'active', -- active, revoked
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS multisig_proposals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, executed, cancelled
    payload JSONB NOT NULL, -- The data being proposed (e.g. manifest upgrade)
    created_by TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS multisig_approvals (
    proposal_id TEXT NOT NULL REFERENCES multisig_proposals(id) ON DELETE CASCADE,
    signer_id TEXT NOT NULL REFERENCES multisig_signers(id),
    signature TEXT NOT NULL, -- Cryptographic signature of the proposal ID
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (proposal_id, signer_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_multisig_proposals_status ON multisig_proposals(status);
CREATE INDEX IF NOT EXISTS idx_multisig_approvals_proposal_id ON multisig_approvals(proposal_id);
