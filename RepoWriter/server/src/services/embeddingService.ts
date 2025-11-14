import { Pool } from 'pg';

const pool = new Pool();

export const storeEmbedding = async (embedding: Buffer) => {
    const result = await pool.query('INSERT INTO memory_nodes (embedding) VALUES ($1) RETURNING id', [embedding]);
    return result.rows[0].id;
};

export const searchEmbedding = async (embedding: Buffer) => {
    const result = await pool.query('SELECT * FROM memory_nodes WHERE embedding = $1', [embedding]);
    return result.rows;
};