import { describe, it, expect } from 'vitest';
import { storeEmbedding, searchEmbedding } from '../src/services/embeddingService';

describe('Embedding Service', () => {
    it('should store and retrieve embedding', async () => {
        const embedding = Buffer.from('test_embedding');
        const id = await storeEmbedding(embedding);
        const results = await searchEmbedding(embedding);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe(id);
    });
});