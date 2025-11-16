import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('openaiClient', () => {
  let realFetch: any;

  beforeEach(() => {
    vi.resetModules();
    realFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_PROJECT_ID = 'proj-test';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_PROJECT_ID;
    vi.restoreAllMocks();
  });

  it('sends Authorization and OpenAI-Project headers and parses JSON', async () => {
    globalThis.fetch = vi.fn(async (url: any, opts: any) => {
      expect(String(url)).toContain('/v1/chat/completions');
      expect(opts?.method).toBe('POST');
      expect(opts?.headers?.Authorization).toBe('Bearer test-key');
      expect(opts?.headers?.['OpenAI-Project']).toBe('proj-test');
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ result: 'ok' }) } }]
          })
      };
    });

    const { chatJson } = await import('../src/services/openaiClient');
    const res = await chatJson('system', 'user');
    expect(res).toEqual({ result: 'ok' });
  });

  it('omits OpenAI-Project header when not present', async () => {
    delete process.env.OPENAI_PROJECT_ID;

    globalThis.fetch = vi.fn(async (_url: any, opts: any) => {
      expect(opts?.headers?.['OpenAI-Project']).toBeUndefined();
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '{}' } }]
          })
      };
    });

    const { chatJson } = await import('../src/services/openaiClient');
    const res = await chatJson('system', 'user');
    expect(res).toEqual({});
  });
});

