-- reasoning-graph/sql/migrations/001_create_reasoning_graph_tables.sql
-- Base schema for Reasoning Graph service (nodes, edges, snapshots).

BEGIN;

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS reason_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN (
        'observation',
        'recommendation',
        'decision',
        'action',
        'hypothesis',
        'policyCheck',
        'score'
    )),
    payload JSONB NOT NULL,
    author TEXT NOT NULL,
    version TEXT,
    manifest_signature_id TEXT,
    audit_event_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reason_nodes_type_idx ON reason_nodes(type);
CREATE INDEX IF NOT EXISTS reason_nodes_author_idx ON reason_nodes(author);
CREATE INDEX IF NOT EXISTS reason_nodes_created_at_idx ON reason_nodes(created_at);

CREATE TABLE IF NOT EXISTS reason_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_node UUID NOT NULL REFERENCES reason_nodes(id) ON DELETE CASCADE,
    to_node UUID NOT NULL REFERENCES reason_nodes(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'causal',
        'supports',
        'contradicts',
        'derivedFrom',
        'influencedBy'
    )),
    weight DOUBLE PRECISION,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reason_edges_from_idx ON reason_edges(from_node);
CREATE INDEX IF NOT EXISTS reason_edges_to_idx ON reason_edges(to_node);
CREATE INDEX IF NOT EXISTS reason_edges_type_idx ON reason_edges(type);

CREATE TABLE IF NOT EXISTS reason_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    root_node_ids UUID[] NOT NULL,
    description TEXT,
    hash TEXT NOT NULL,
    signature TEXT NOT NULL,
    signer_id TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reason_snapshots_signer_idx ON reason_snapshots(signer_id);
CREATE INDEX IF NOT EXISTS reason_snapshots_created_idx ON reason_snapshots(created_at);

COMMIT;
