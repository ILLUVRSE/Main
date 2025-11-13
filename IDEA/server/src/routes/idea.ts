import { Router } from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { readJson, writeJsonAtomic } from '../utils/storage';
import { chat as ollamaChat } from '../utils/ollama';

const router = Router();

const DATA_PATH = path.resolve(process.cwd(), 'data/ideas.json');

export interface IdeaGeneration {
  id: string;
  createdAt: string;
  text: string;
}

export interface Idea {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  history: IdeaGeneration[];
}

interface IdeaStore {
  ideas: Idea[];
}

let cache: IdeaStore | null = null;

export function __resetIdeaCacheForTests() {
  cache = null;
}

async function loadStore(): Promise<IdeaStore> {
  if (cache) {
    return cache;
  }
  const data = await readJson<IdeaStore>(DATA_PATH, { ideas: [] });
  cache = { ideas: Array.isArray(data.ideas) ? data.ideas : [] };
  return cache;
}

async function persistStore(): Promise<void> {
  if (!cache) {
    return;
  }
  await writeJsonAtomic(DATA_PATH, cache);
}

router.get('/idea', async (_req, res) => {
  try {
    const store = await loadStore();
    const ideas = store.ideas.map(({ history, ...idea }) => idea);
    return res.json({ ok: true, ideas });
  } catch (err: any) {
    const message = err?.message ?? 'Unable to read ideas';
    return res.status(500).json({ ok: false, error: message });
  }
});

router.get('/idea/:id', async (req, res) => {
  try {
    const store = await loadStore();
    const idea = store.ideas.find((item) => item.id === req.params.id);
    if (!idea) {
      return res.status(404).json({ ok: false, error: 'idea not found' });
    }
    return res.json({ ok: true, idea });
  } catch (err: any) {
    const message = err?.message ?? 'Unable to read idea';
    return res.status(500).json({ ok: false, error: message });
  }
});

router.post('/idea', async (req, res) => {
  const { title, description } = req.body ?? {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ ok: false, error: 'title is required' });
  }
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ ok: false, error: 'description is required' });
  }

  try {
    const store = await loadStore();
    const idea: Idea = {
      id: randomUUID(),
      title: title.trim(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
      history: []
    };
    store.ideas.push(idea);
    await persistStore();
    return res.status(201).json({ ok: true, idea });
  } catch (err: any) {
    const message = err?.message ?? 'Unable to create idea';
    const status = /lock/i.test(message) ? 503 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
});

router.post('/idea/:id/generate', async (req, res) => {
  try {
    const store = await loadStore();
    const idea = store.ideas.find((item) => item.id === req.params.id);
    if (!idea) {
      return res.status(404).json({ ok: false, error: 'idea not found' });
    }

    const systemPrompt = 'You are IDEA (ILLUVRSE), a local creative assistant for repository maintainers. Provide concise, actionable insights and reference concrete improvements developers can make.';
    const text = await ollamaChat([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Project idea: ${idea.title}\nDescription:\n${idea.description}\nShare the next steps and suggested repo changes.`
      }
    ]);

    const generation: IdeaGeneration = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      text
    };

    idea.history.push(generation);
    await persistStore();

    const diffSuggestion = `Consider committing updates inspired by "${idea.title}" to documentation or source modules most affected.`;

    return res.json({ ok: true, generation, diffSuggestion });
  } catch (err: any) {
    const message = err?.message ?? 'Unable to generate insight';
    const status = /Ollama/.test(message) ? 502 : /lock/i.test(message) ? 503 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
});

export default router;
