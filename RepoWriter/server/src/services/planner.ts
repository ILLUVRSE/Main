/**
 * planner.ts (updated)
 *
 * Produce a structured plan of edits given a natural-language prompt and optional memory.
 * Enhancements:
 *  - Use server-side contextProvider to attach repo summaries/snippets into the user payload.
 *  - Improved JSON extraction heuristics: attempts direct JSON parse, then looks for the
 *    first {...} JSON substring, then falls back to wrapping raw text.
 *  - Attach meta.context describing which files (path + tokensEstimate) were provided to the model.
 *
 * The public API remains:
 *   export async function planEdits(prompt: string, memory: string[] = []): Promise<Plan>
 */

import { chatJson } from "./openaiClient.js";
import { REPO_PATH } from "../config.js";
import contextProvider from "./contextProvider.js";
import tokenManager from "./tokenManager.js";

export type PatchObject = {
  path: string;
  content?: string; // full file content (create/replace)
  diff?: string; // unified diff string
};

export type PlanStep = {
  explanation: string;
  patches: PatchObject[];
};

export type Plan = {
  steps: PlanStep[];
  meta?: Record<string, any>;
};

/**
 * Build a concise system prompt that instructs the model to respond with strict JSON.
 */
function buildSystemPrompt(): string {
  return [
    "You are RepoWriter's planning agent. Your job is to produce a clear, structured plan",
    "that describes code edits (as either full file contents or unified diffs) to satisfy a user's request.",
    "",
    "REQUIREMENTS:",
    "- Respond with a single JSON object and nothing else.",
    "- JSON MUST be: { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }",
    "- 'path' should be a repository-relative path (no absolute paths).",
    "- Prefer returning 'content' for new/replace files; use 'diff' only when you intentionally produce a unified diff.",
    `- REPO_PATH: ${REPO_PATH}`,
    "",
    "If you cannot produce a structured result, return { steps: [{ explanation: 'error', patches: [] }] }.",
    ""
  ].join("\n");
}

/**
 * Convert the user prompt + memory into a compact user payload for the model.
 * We optionally enrich the prompt with a repository context fragment.
 */
function buildUserPayload(prompt: string, memory: string[] = [], contextFragment?: string) {
  // If contextFragment is provided, append markers and JSON so model can reference.
  const payload = {
    prompt: contextFragment ? `${prompt}\n\n[Repository context: summaries and snippets follow]${contextFragment}` : prompt,
    memory,
    guidance: "Return a structured plan in the JSON schema described in the system prompt."
  };
  return JSON.stringify(payload);
}

/** Attempt to find and parse a JSON substring inside a larger text blob. */
function extractJsonFromText(txt: string): any | null {
  if (!txt || typeof txt !== "string") return null;
  const trimmed = txt.trim();

  // If text itself is JSON, parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // try to find first JSON object substring
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const cand = trimmed.slice(first, last + 1);
      try {
        return JSON.parse(cand);
      } catch {
        // fallback: try to find array-style
        const fArr = trimmed.indexOf("[");
        const lArr = trimmed.lastIndexOf("]");
        if (fArr !== -1 && lArr !== -1 && lArr > fArr) {
          const candArr = trimmed.slice(fArr, lArr + 1);
          try {
            return JSON.parse(candArr);
          } catch {
            // no-op
          }
        }
      }
    }
  }
  return null;
}

/**
 * Try to coerce an arbitrary model output into a Plan object.
 * If parsing fails, return a fallback Plan that preserves the raw content.
 */
function normalizePlan(raw: any, contextMeta?: any): Plan {
  // If model already returned an object with steps, validate
  if (raw && typeof raw === "object" && Array.isArray(raw.steps)) {
    // Basic validation of steps / patches shape
    const steps: PlanStep[] = raw.steps.map((s: any) => {
      const explanation = String(s.explanation ?? "");
      const patches: PatchObject[] = Array.isArray(s.patches)
        ? s.patches.map((p: any) => ({
            path: String(p.path ?? ""),
            content: typeof p.content === "string" ? p.content : undefined,
            diff: typeof p.diff === "string" ? p.diff : undefined
          }))
        : [];
      return { explanation, patches };
    });
    const meta = Object.assign({}, raw.meta ?? {}, contextMeta ?? {});
    return { steps, meta };
  }

  // If raw is a string, attempt to extract JSON substring
  if (typeof raw === "string") {
    const parsed = extractJsonFromText(raw);
    if (parsed && parsed.steps && Array.isArray(parsed.steps)) {
      return normalizePlan(parsed, contextMeta);
    }
  }

  // If raw is an object wrapper like { raw: "..." } attempt to extract JSON from raw.raw
  if (raw && typeof raw === "object" && typeof raw.raw === "string") {
    const parsed = extractJsonFromText(raw.raw);
    if (parsed && parsed.steps && Array.isArray(parsed.steps)) {
      return normalizePlan(parsed, contextMeta);
    }
    // else wrap raw text into a single-step fallback
    return {
      steps: [
        {
          explanation: "Model output could not be parsed as a structured plan; see raw field.",
          patches: [
            {
              path: "",
              content: `__raw_model_output__:\n${String(raw.raw).slice(0, 32000)}`
            }
          ]
        }
      ],
      meta: Object.assign({ unparsable: true }, contextMeta ?? {})
    };
  }

  // Final fallback: wrap the raw object stringified
  return {
    steps: [
      {
        explanation: "Model output could not be parsed as a structured plan; see raw field.",
        patches: [
          {
            path: "",
            content: `__raw_model_output__:\n${JSON.stringify(raw, null, 2).slice(0, 32000)}`
          }
        ]
      }
    ],
    meta: Object.assign({ unparsable: true }, contextMeta ?? {})
  };
}

/**
 * Helper: Build a compact context fragment from contextProvider results.
 * Matches the shape used by codex.ts so both remain consistent.
 */
function buildContextFragment(files: Array<{ path: string; summary?: string; snippet?: string }>) {
  const parts = files.map(f => {
    const s = f.summary ? f.summary : "";
    const sn = f.snippet ? f.snippet.split("\n").slice(0, 8).join("\\n") : "";
    return { path: f.path, summary: s, snippet: sn };
  });
  return `\n\n--REPO_CONTEXT_START--\n${JSON.stringify({ files: parts })}\n--REPO_CONTEXT_END--\n\n`;
}

/**
 * Public API: produce a plan from a user prompt and optional memory.
 *
 * This delegates to chatJson and normalizes the response into our Plan type.
 * We enhance the user payload with repository context (summaries/snippets) when available.
 */
export async function planEdits(prompt: string, memory: string[] = []): Promise<Plan> {
  const system = buildSystemPrompt();

  // Build context (best-effort). Use tokenManager heuristics to set budget.
  const contextOptions = { tokenBudget: 1200, topK: 8 };
  let contextFragment: string | undefined = undefined;
  let contextMeta: any = undefined;
  try {
    const ctx = await contextProvider.buildContext(prompt, contextOptions);
    if (ctx && Array.isArray(ctx.files) && ctx.files.length > 0) {
      contextFragment = buildContextFragment(ctx.files);
      contextMeta = { context: { files: ctx.files.map((f: any) => ({ path: f.path, tokensEstimate: f.tokensEstimate })) , totalTokens: ctx.totalTokens } };
    }
  } catch (err) {
    // ignore context errors but record in meta for debugging
    contextMeta = { contextError: String(err?.message || err) };
  }

  const user = buildUserPayload(prompt, memory, contextFragment);

  let res: any;
  try {
    res = await chatJson(system, user);
  } catch (err: any) {
    // bubble a safe structured error plan
    return {
      steps: [
        {
          explanation: `planner: model call failed: ${String(err?.message || err)}`,
          patches: []
        }
      ],
      meta: Object.assign({ error: true }, contextMeta ?? {})
    };
  }

  // If model returned a string or raw wrapper, normalize and attempt extraction
  try {
    // chatJson already attempts to parse model content; it may return an object or { raw: "..." }
    // Normalize and attach context meta
    return normalizePlan(res, contextMeta);
  } catch (err: any) {
    return {
      steps: [
        {
          explanation: `planner: normalization failed: ${String(err?.message || err)}`,
          patches: []
        }
      ],
      meta: Object.assign({ error: true }, contextMeta ?? {})
    };
  }
}

export default { planEdits };

