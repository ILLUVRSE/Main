/**
 * planner.ts
 *
 * Produce a structured plan of edits given a natural-language prompt and optional memory.
 * The planner calls into the OpenAI client (chatJson) and expects the model to return
 * a JSON object shaped like:
 *
 * { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }
 *
 * This file implements a conservative wrapper around the model call: it provides a
 * clear system prompt, calls chatJson, validates the result and returns a safe JS object.
 */

import { chatJson } from "./openaiClient.js";
import { REPO_PATH } from "../config.js";

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
 */
function buildUserPayload(prompt: string, memory: string[] = []) {
  return JSON.stringify({
    prompt,
    memory,
    guidance: "Return a structured plan in the JSON schema described in the system prompt."
  });
}

/**
 * Try to coerce an arbitrary model output into a Plan object.
 * If parsing fails, return a fallback Plan that preserves the raw content.
 */
function normalizePlan(raw: any): Plan {
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
    return { steps, meta: raw.meta ?? {} };
  }

  // Fallback: model returned something unparsable — wrap it so caller can surface raw text
  return {
    steps: [
      {
        explanation: "Model output could not be parsed as a structured plan; see raw field.",
        patches: [
          {
            path: "",
            content: `__raw_model_output__:\n${JSON.stringify(raw, null, 2)}`
          }
        ]
      }
    ],
    meta: { unparsable: true }
  };
}

/**
 * Public API: produce a plan from a user prompt and optional memory.
 *
 * This delegates to chatJson and normalizes the response into our Plan type.
 */
export async function planEdits(prompt: string, memory: string[] = []): Promise<Plan> {
  const system = buildSystemPrompt();
  const user = buildUserPayload(prompt, memory);

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
      meta: { error: true }
    };
  }

  // If model already returned a nested JSON, normalize it; otherwise attempt to parse raw strings.
  if (typeof res === "string") {
    try {
      const parsed = JSON.parse(res);
      return normalizePlan(parsed);
    } catch {
      // couldn't parse string response; include raw as fallback
      return normalizePlan({ raw: res });
    }
  }

  return normalizePlan(res);
}

export default { planEdits };

