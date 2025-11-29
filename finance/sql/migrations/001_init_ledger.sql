CREATE TABLE IF NOT EXISTS ledger_entries (
  journal_id UUID PRIMARY KEY,
  batch_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  currency VARCHAR(3) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  id SERIAL PRIMARY KEY,
  journal_id UUID REFERENCES ledger_entries(journal_id),
  account_id VARCHAR(255) NOT NULL,
  direction VARCHAR(10) CHECK (direction IN ('debit', 'credit')),
  amount BIGINT NOT NULL,
  memo TEXT
);

CREATE TABLE IF NOT EXISTS allocations (
  allocation_id UUID PRIMARY KEY,
  entity_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  resources JSONB NOT NULL,
  ledger_proof_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
