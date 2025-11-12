/**
 * server/src/services/llm.ts
 *
 * Adapter that re-exports the localllm service under the `llm` name
 * and provides a `streamLocalGenerate` helper with the same signature used
 * elsewhere (prompt, onChunk, onDone, onError).
 *
 * This keeps the server-side llm API compatible with the client code and
 * the web-side helpers that call `llm.streamLocalGenerate(...)`.
 */

import localllm from "./localllm.js";

export type Plan = any;

/** Synchronous plan generator */
export async function generateLocalPlan(prompt: string): Promise<Plan> {
  return await (localllm as any).generateLocalPlan(prompt);
}

/**
 * streamLocalGenerate
 *
 * High-level streaming helper matching the client signature:
 *   streamLocalGenerate(prompt, onChunk, onDone, onError)
 *
 * It converts the simple `prompt` into a system/user pair (same convention used
 * by planner) and proxies chunks from localllm.streamLocalPlan to the callbacks.
 */
export async function streamLocalGenerate(
  prompt: string,
  onChunk?: (chunk: string) => void,
  onDone?: () => void,
  onError?: (err: Error) => void
): Promise<void> {
  const system = [
    "You are RepoWriter's planning agent. Produce a structured plan as JSON only.",
    "JSON schema: { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }",
    "Return only JSON fragments or text that can be combined into JSON. If streaming partial text, ensure final output is valid JSON."
  ].join("\n");

  const user = JSON.stringify({
    prompt,
    memory: [],
    guidance: "Stream a structured JSON plan as you generate it."
  });

  try {
    const gen = (localllm as any).streamLocalPlan(system, user);
    for await (const chunk of gen) {
      try {
        // chunk may be { raw: "..." } or a string
        let raw: string;
        if (typeof chunk === "string") {
          raw = chunk;
        } else if (chunk && typeof chunk === "object") {
          // prefer chunk.raw, fallback to chunk.text or JSON stringify
          raw = String((chunk as any).raw ?? (chunk as any).text ?? JSON.stringify(chunk));
        } else {
          raw = String(chunk);
        }
        onChunk?.(raw);
      } catch {
        // ignore per-chunk errors to keep streaming
      }
    }
    try { onDone?.(); } catch {}
  } catch (err: any) {
    try { onError?.(err); } catch {}
    throw err;
  }
}

/** Default export for convenience */
export default {
  generateLocalPlan,
  streamLocalGenerate
};

