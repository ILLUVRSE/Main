// kernel/test/unit/embedding/vecdb.test.ts
import { InMemoryVectorStore, HttpVectorStore, createVectorStore } from '../../../src/embedding/vecdb';

jest.mock('node-fetch', () => jest.fn());

const fetchMock = require('node-fetch') as jest.MockedFunction<any>;

describe('vector db wrapper', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    delete process.env.VECDB_PROVIDER;
    delete process.env.VECTOR_DB_ENDPOINT;
    delete process.env.VECTOR_DB_API_KEY;
  });

  test('in-memory store ranks by cosine similarity', async () => {
    const store = new InMemoryVectorStore();
    await store.upsertEmbedding('north', [1, 0]);
    await store.upsertEmbedding('east', [0, 1]);

    const matches = await store.query([1, 0], 1);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('north');
    expect(matches[0].score).toBeGreaterThan(0.9);
  });

  test('http store forwards upsert and query', async () => {
    const jsonMock = jest.fn().mockResolvedValue({ matches: [{ id: 'x', score: 0.42 }] });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: jsonMock,
    } as any);

    const store = new HttpVectorStore('https://vecdb.example.com', 'secret');
    await store.upsertEmbedding('node-1', [0.1, 0.2, 0.3], { topic: 'demo' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://vecdb.example.com/embeddings/node-1',
      expect.objectContaining({ method: 'PUT' }),
    );

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: jsonMock,
    } as any);

    const matches = await store.query([0.1, 0.2, 0.3], 5);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://vecdb.example.com/query',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(matches).toEqual([{ id: 'x', score: 0.42 }]);
  });

  test('createVectorStore defaults to memory provider', () => {
    const store = createVectorStore();
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  test('createVectorStore requires endpoint for http provider', () => {
    expect(() => createVectorStore({ provider: 'http' as any })).toThrow(/VECTOR_DB_ENDPOINT/);
  });
});

