import "dotenv/config";

const apiKey = process.env.OPENAI_API_KEY;
const projectId = process.env.OPENAI_PROJECT_ID;

if (!apiKey) throw new Error("Missing OPENAI_API_KEY in .env");
if (!projectId) throw new Error("Missing OPENAI_PROJECT_ID in .env");

export async function chatJson(system: string, user: string): Promise<any> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Project": projectId
  };

  const body = {
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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

