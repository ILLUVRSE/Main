import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockQuery = jest.fn();

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: (...args: any[]) => mockQuery(...args)
    }))
  };
});

import { storeEmbedding, searchEmbedding } from '../src/services/embeddingService';

describe('Embedding Service', () => {
    let store: Array<{ id: number; embedding: Buffer }>;
    let idCounter: number;

    beforeEach(() => {
        store = [];
        idCounter = 1;
        mockQuery.mockReset();
        mockQuery.mockImplementation(async (sql: string, params: any[]) => {
            if (/insert/i.test(sql)) {
                const record = { id: idCounter++, embedding: params[0] };
                store.push(record);
                return { rows: [{ id: record.id }] };
            }
            if (/select/i.test(sql)) {
                const matches = store.filter((row) => row.embedding.equals(params[0]));
                return { rows: matches };
            }
            throw new Error('Unexpected query');
        });
    });

    it('should store and retrieve embedding', async () => {
        const embedding = Buffer.from('test_embedding');
        const id = await storeEmbedding(embedding);
        const results = await searchEmbedding(embedding);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe(id);
    });
});
