/**
 * marketplace/server/lib/agentProxy.ts
 *
 * Small server-side agent proxy used by `routes/agent.route.ts`.
 *
 * Responsibilities:
 * - Accepts a prompt + context + actorId and returns a normalized agent response:
 *     { reply?: string, actions?: any[], meta?: any }
 * - If `AGENT_BACKEND_URL` is configured, forwards the request to that service.
 * - Otherwise, if `OPENAI_API_KEY` is configured, uses OpenAI Chat completions (basic).
 * - Otherwise falls back to a harmless mock reply (useful for local dev).
 *
 * Security:
 * - This module **must** be the place you enforce (or expect) server-side policy,
 *   action authorization, and auditing. The caller (route) should also emit audit events.
 *
 * Configuration (env):
 *  - AGENT_BACKEND_URL  — prefer this: full URL of an internal Agent Builder service, e.g. https://agent.internal/api/query
 *  - OPENAI_API_KEY     — if AGENT_BACKEND_URL not present, use OpenAI Chat completions
 *  - OPENAI_API_HOST    — optional override for OpenAI-like host (default: https://api.openai.com)
 *  - AGENT_PROXY_MODE   — 'mock' to force a canned response
 *
 * Note: adapt the HTTP shapes below to match the agent backend you deploy.
 */

import fetch from 'node-fetch'; // Node 18+ has global fetch, but using node-fetch import works in many environments
// If your runtime already has global fetch, you can remove the import above.

type QueryOpts = {
  prompt: string;
  context?: Record<string, any>;
  actorId?: string | null;
  // optional allowed actions for this agent invocation (server-side enforcement)
  allowedActions?: string[];
  // free-form metadata
  meta?: Record<string, any>;
};

type AgentReply = {
  reply?: string;
  actions?: any[];
  meta?: any;
};

const AGENT_BACKEND_URL = process.env.AGENT_BACKEND_URL || process.env.MARKETPLACE_AGENT_BACKEND_URL || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_HOST = process.env.OPENAI_API_HOST || 'https://api.openai.com';
const AGENT_PROXY_MODE = (process.env.AGENT_PROXY_MODE || '').toLowerCase(); // 'mock' possible

async function callAgentBackend(opts: QueryOpts): Promise<AgentReply> {
  // Expect the agent backend to accept { prompt, context, actorId, allowedActions, meta }
  // and return JSON { reply, actions, meta }.
  const target = AGENT_BACKEND_URL;
  if (!target) throw new Error('AGENT_BACKEND_URL not configured');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // If the agent backend needs internal service auth, set AGENT_BACKEND_API_KEY in environment and forward it.
  if (process.env.AGENT_BACKEND_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.AGENT_BACKEND_API_KEY}`;
  }

  const res = await fetch(target, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: opts.prompt,
      context: opts.context || {},
      actorId: opts.actorId || null,
      allowedActions: opts.allowedActions || [],
      meta: opts.meta || {},
    }),
    // set a reasonable timeout by using AbortController from caller if needed
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Agent backend error ${res.status}: ${txt}`);
  }

  const json = await res.json().catch(() => ({}));
  // Normalize shape
  return {
    reply: json.reply || json.text || json.result || '',
    actions: json.actions || json.actions || [],
    meta: json.meta || json,
  };
}

async function callOpenAIChat(opts: QueryOpts): Promise<AgentReply> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  // Basic chat completion usage: single user message with a brief system prompt for safety.
  // For production, replace with the Agent Builder / Actions API and define tool bindings.
  const url = `${OPENAI_API_HOST.replace(/\/$/, '')}/v1/chat/completions`;
  const systemPrompt =
    'You are a helpful assistant for the Illuvrse Marketplace. Keep answers concise and actionable. When appropriate, produce JSON "actions" describing suggested backend operations (createCheckout, validateManifest, verifyProof) with fields required. Do not perform any sensitive operations yourself.';

  const body: any = {
    model: 'gpt-4o-mini', // change to appropriate model in prod
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(opts.prompt) },
    ],
    max_tokens: 800,
    temperature: 0.2,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }

  const json = await res.json();
  // Extract assistant text
  const choice = (json.choices && json.choices[0]) || null;
  const replyText = (choice && (choice.message?.content || choice.text)) || '';

  // Attempt to parse an "actions" block if present in assistant text (JSON codeblock heuristic)
  let actions: any[] = [];
  try {
    // Look for a JSON object in the reply
    const firstJsonMatch = replyText.match(/```json\s*([\s\S]*?)\s*```/i) || replyText.match(/({[\s\S]*})/);
    if (firstJsonMatch && firstJsonMatch[1]) {
      const parsed = JSON.parse(firstJsonMatch[1]);
      if (Array.isArray(parsed.actions)) actions = parsed.actions;
      else if (parsed.actions) actions = [parsed.actions];
    }
  } catch {
    // ignore parse errors - actions remain empty
  }

  return { reply: String(replyText), actions, meta: { raw: json } };
}

/**
 * Main exported function.
 */
export async function queryAgent(opts: QueryOpts): Promise<AgentReply> {
  if (!opts || !opts.prompt) throw new Error('prompt is required');

  // Mock mode for local development/testing
  if (AGENT_PROXY_MODE === 'mock') {
    return {
      reply: `Mock reply (AGENT_PROXY_MODE=mock) — you asked: ${String(opts.prompt).slice(0, 240)}`,
      actions: [],
      meta: { mode: 'mock' },
    };
  }

  // Prefer calling an internal agent backend if configured
  if (AGENT_BACKEND_URL) {
    try {
      return await callAgentBackend(opts);
    } catch (err) {
      // Log and fall through to other strategies
      // eslint-disable-next-line no-console
      console.error('agentProxy: callAgentBackend failed:', (err as Error).message || err);
      throw err; // prefer failing fast so admins notice misconfiguration
    }
  }

  // Fall back to OpenAI chat if API key present
  if (OPENAI_API_KEY) {
    try {
      return await callOpenAIChat(opts);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('agentProxy: callOpenAIChat failed:', (err as Error).message || err);
      throw err;
    }
  }

  // Final fallback: harmless canned response
  return {
    reply:
      'Agent is not configured. To enable agent functionality, configure AGENT_BACKEND_URL or OPENAI_API_KEY. (This is a fallback response.)',
    actions: [],
    meta: { configured: false },
  };
}

export default {
  queryAgent,
};

