import { Router } from 'express';
import { chat as ollamaChat } from '../utils/ollama';
import type { ChatMessage } from '../utils/ollama';

const router = Router();

router.post('/', async (req, res) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: 'messages must be a non-empty array' });
  }

  const payload: ChatMessage[] = [];
  for (const item of messages) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ ok: false, error: 'each message must be an object with role and content' });
    }
    const { role, content } = item;
    if (typeof role !== 'string' || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ ok: false, error: 'message role/content invalid' });
    }
    payload.push({ role, content });
  }

  try {
    const text = await ollamaChat(payload);
    return res.json({ ok: true, text });
  } catch (err: any) {
    const message = err?.message ?? 'Failed to complete chat request';
    return res.status(502).json({ ok: false, error: message });
  }
});

export default router;
