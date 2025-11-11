import { getOpenAIHeaders } from '../config.js';

export async function chatJson(system: string, user: string): Promise<any> {
  const headers: Record<string,string> = getOpenAIHeaders();
  const OPENAI_BASE = process.env.OPENAI_API_URL || "https://api.openai.com";

  const body = {
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}: ${text}`);
  }

  const json = JSON.parse(text);
  const content = json?.choices?.[0]?.message?.content ?? "{}";

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

