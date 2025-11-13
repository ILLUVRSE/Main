-- Schema for memory_nodes table
CREATE TABLE memory_nodes (
    id SERIAL PRIMARY KEY,
    embedding BYTEA NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Schema for artifact table
CREATE TABLE artifact (
    id SERIAL PRIMARY KEY,
    memory_node_id INTEGER REFERENCES memory_nodes(id),
    data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);