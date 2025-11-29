-- reasoning-graph/sql/migrations/002_add_annotations_and_edge_audit.sql

BEGIN;

-- Add audit_event_id to reason_edges if not exists
ALTER TABLE reason_edges ADD COLUMN IF NOT EXISTS audit_event_id TEXT;

-- Create annotations table
CREATE TABLE IF NOT EXISTS reason_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('node', 'edge')),
    annotation_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    audit_event_id TEXT, -- Reference to the audit event that created this annotation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reason_annotations_target_idx ON reason_annotations(target_id, target_type);
CREATE INDEX IF NOT EXISTS reason_annotations_created_at_idx ON reason_annotations(created_at);

COMMIT;
