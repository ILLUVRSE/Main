CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY,
  artifact_id VARCHAR(255) NOT NULL,
  reason TEXT,
  score DOUBLE PRECISION,
  status VARCHAR(50) NOT NULL,
  target_env VARCHAR(50),
  traffic_percent INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  audit_context JSONB,
  metadata JSONB,
  event_id VARCHAR(255),
  idempotency_key VARCHAR(255) UNIQUE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(255) NOT NULL,
  actor VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
