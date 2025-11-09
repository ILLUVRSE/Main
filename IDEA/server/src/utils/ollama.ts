import axios from 'axios';

const DEFAULT_TIMEOUT = 30000;

const API_URL = process.env.OLLAMA_API_URL ?? 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'llama2';

const client = axios.create({
  baseURL: API_URL,
  timeout: DEFAULT_TIMEOUT,
  headers: {
    'Content-Type': 'application/json'
  }
});

export type ChatMessage = {
  role: string;
  content: string;
};

function buildError(message: string): Error {
  return new Error(`${message} — ensure Ollama is running locally. See server README for setup instructions.`);
}

type ChatImpl = (messages: ChatMessage[]) => Promise<string>;
type GenerateImpl = (prompt: string) => Promise<string>;

let chatOverride: ChatImpl | null = null;
let generateOverride: GenerateImpl | null = null;

export function __setChatImplementationForTests(fn: ChatImpl | null) {
  chatOverride = fn;
}

export function __setGenerateImplementationForTests(fn: GenerateImpl | null) {
  generateOverride = fn;
}

export async function chat(messages: ChatMessage[]): Promise<string> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('No messages provided for chat request.');
  }

  if (chatOverride) {
    return chatOverride(messages);
  }

  try {
    const response = await client.post('/api/chat', {
      model: MODEL,
      messages,
      stream: false
    });

    const data = response.data as any;
    const text = data?.message?.content ?? data?.content ?? data?.response;
    if (!text || typeof text !== 'string') {
      throw buildError('Received empty response from Ollama');
    }
    return text;
  } catch (err: any) {
    if (err?.response) {
      const detail = err.response.data?.error ?? err.response.statusText ?? 'Unknown error';
      throw buildError(`Ollama chat request failed (${detail})`);
    }
    if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND') {
      throw buildError('Cannot reach Ollama service');
    }
    throw buildError(err?.message ?? 'Unexpected Ollama error');
  }
}

export async function generate(prompt: string): Promise<string> {
  if (!prompt?.trim()) {
    throw new Error('Prompt must be a non-empty string.');
  }

  if (generateOverride) {
    return generateOverride(prompt);
  }

  try {
    const response = await client.post('/api/generate', {
      model: MODEL,
      prompt,
      stream: false
    });
    const data = response.data as any;
    const text = data?.response ?? data?.message?.content;
    if (!text || typeof text !== 'string') {
      throw buildError('Received empty response from Ollama');
    }
    return text;
  } catch (err: any) {
    if (err?.response) {
      const detail = err.response.data?.error ?? err.response.statusText ?? 'Unknown error';
      throw buildError(`Ollama generate request failed (${detail})`);
    }
    if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND') {
      throw buildError('Cannot reach Ollama service');
    }
    throw buildError(err?.message ?? 'Unexpected Ollama error');
  }
}
