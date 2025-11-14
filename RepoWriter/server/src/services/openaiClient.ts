const DEFAULT_BASE_URL = process.env.OPENAI_API_URL || 'https://api.openai.com';

function buildHeaders() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required to call chatJson');
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  if (process.env.OPENAI_PROJECT_ID) {
    headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID;
  }
  return headers;
}

export async function chatJson(systemPrompt: string, userPrompt: string) {
  const headers = buildHeaders();
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  const response = await fetch(`${DEFAULT_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const raw = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Unable to parse OpenAI response');
  }

  const content = parsed?.choices?.[0]?.message?.content ?? '';
  if (!content) {
    return {};
  }

  try {
    return JSON.parse(content);
  } catch {
    return { text: content };
  }
}

export default { chatJson };
