-- Postgres schema for memory_nodes and artifact

CREATE TABLE memory_nodes (
    id SERIAL PRIMARY KEY,
    node_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE artifact (
    id SERIAL PRIMARY KEY,
    artifact_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
