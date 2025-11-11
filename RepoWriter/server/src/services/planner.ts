import { chatJson } from "./openaiClient.js";
import { snapshotUsage, addUsage } from "./usage.js";

/** Returns a plan: array of patches with path + full new content (MVP).
 *  You can later upgrade to true unified diffs. */
export async function planEdits(prompt: string, memory: string[]) {
  const system = `You are RepoWriter. Output JSON: { "patches": [ { "path": "relative/path", "content": "FULL FILE CONTENT" } ] }.
- Only include files inside the repo.
- Return minimal set of files to implement the prompt.
- If creating new files, include full content.
- Do not add explanations. JSON only.`;
  const res = await chatJson(system, `Memory:\n${memory.join("\n")}\n\nPrompt:\n${prompt}`);
  addUsage({ tokens_est: 1200, dollars_est: 0.003 }); // rough placeholder
  return res;
}

