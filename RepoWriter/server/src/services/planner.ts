// planner.ts — LLM-backed planner
import express from "express";
const router = express.Router();

router.get('/api/hello', (req, res) => {
  res.status(200).json({ msg: 'hello' });
});

export default router;

/**
 * planEdits(prompt, memory)
 * - Calls OpenAI chat completions (gpt-3.5-turbo) and expects a JSON reply:
 *   { steps: [...], patches: [{ path: "...", content: "..." }, ...] }
 * - If OpenAI fails or returns unparsable output, returns empty plan.
 */
export async function planEdits(prompt: any, memory: any[] = []) {
  const sys = `You are a repository engineer. When asked to "implement" or "create" files,
respond with *only* a single JSON object (no surrounding text) with this shape:
{
  "steps": ["short human-friendly step descriptions..."],
  "patches": [
    { "path": "relative/path/to/file", "content": "file contents as a string" }
  ]
}
Ensure code blocks or backticks are NOT included around the JSON. Keep contents valid for the file type (YAML, Markdown, JS, etc.).`;

  try {
    const body = {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: String(prompt) }
      ],
      temperature: 0.2,
      max_tokens: 1500
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text().catch(()=>"<no-body>");
      console.error("OpenAI HTTP error", res.status, txt);
      return { steps: [], patches: [] };
    }

    const data = await res.json();
    const content = (data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "").toString().trim();

    // strip triple-backtick blocks if the model wrapped the JSON in them
    let candidate = content;
    const m = candidate.match(/```(?:json)?\n([\s\S]*?)\n```/i);
    if (m) candidate = m[1].trim();

    // try parse; if fails, attempt to extract first {...} block
    let parsed: any = null;
    try { parsed = JSON.parse(candidate); } catch (e) {
      const i = candidate.indexOf('{');
      const j = candidate.lastIndexOf('}');
      if (i !== -1 && j !== -1 && j > i) {
        try { parsed = JSON.parse(candidate.slice(i, j+1)); } catch (e2) { parsed = null; }
      }
    }

    if (!parsed || !Array.isArray(parsed.patches) || !Array.isArray(parsed.steps)) {
      console.error("Planner: parsed response invalid:", { parsed });
      return { steps: [], patches: [] };
    }

    // basic validation of patches
    parsed.patches = parsed.patches.map((p: any) => ({
      path: String(p.path || p.file || ""),
      content: typeof p.content === "string" ? p.content : String(p.content ?? "")
    })).filter((p: any) => p.path);

    return { steps: parsed.steps, patches: parsed.patches };
  } catch (err) {
    console.error("planner error", err);
    return { steps: [], patches: [] };
  }
}

