/**
 * web/src/services/llm.ts
 *
 * Minimal local LLM adapter used by the web client when the backend is set to "local".
 * This is intentionally simple and deterministic so the frontend works when offline or
 * for UI development without calling the real OpenAI server.
 *
 * Exports:
 *  - generateLocalPlan(prompt: string): Promise<Plan>
 *  - streamLocalGenerate(prompt: string, onChunk, onDone, onError): Promise<void>
 *
 * The Plan shape matches web/src/services/api.ts expectations:
 *  { steps: [ { explanation: string, patches: [ { path, content?, diff? } ] } ], meta?: {} }
 */

export type PatchObj = {
  path: string;
  content?: string;
  diff?: string;
};

export type PlanStep = {
  explanation: string;
  patches: PatchObj[];
};

export type Plan = {
  steps: PlanStep[];
  meta?: Record<string, any>;
};

/** Simple deterministic mock plan generator */
export async function generateLocalPlan(prompt: string): Promise<Plan> {
  // Very simple heuristics so the UI can show realistic results:
  // - If prompt mentions "hello" create hello.txt
  // - If prompt mentions "add" + filename produce a file with that name
  const p = (prompt || "").toLowerCase();

  const steps: PlanStep[] = [];

  if (p.includes("hello")) {
    steps.push({
      explanation: "Create hello.txt with a friendly greeting.",
      patches: [
        { path: "hello.txt", content: "Hello from RepoWriter local mock!\n" }
      ]
    });
  }

  // detect "add <name>" pattern (very loose)
  const addMatch = prompt.match(/add\s+([\w\-./]+(?:\.\w+)?)/i);
  if (addMatch && addMatch[1]) {
    const fname = addMatch[1];
    steps.push({
      explanation: `Add file ${fname} with a stub implementation.`,
      patches: [
        { path: fname, content: `// Created by RepoWriter local mock\n\n// TODO: implement ${fname}\n` }
      ]
    });
  }

  // fallback: create a multi-step plan example
  if (steps.length === 0) {
    steps.push({
      explanation: "Update README with short summary of change and create a smoke file.",
      patches: [
        { path: "README.md", content: `# Changes\n\nPrompt: ${prompt}\n\nThis is a mock plan produced by the local LLM.` },
        { path: "smoke-local.txt", content: "smoke-local\n" }
      ]
    });
  }

  const plan: Plan = { steps, meta: { localMock: true, promptPreview: (prompt || "").slice(0, 200) } };
  // Simulate a tiny delay to feel realistic
  await new Promise((r) => setTimeout(r, 120));
  return plan;
}

/**
 * streamLocalGenerate
 *
 * Simulates streaming output. Calls onChunk with string chunks (the frontend
 * expects plain string chunks, which it will append and attempt parsing).
 *
 * This emits the JSON plan as one or more chunks (split roughly), then calls onDone().
 */
export async function streamLocalGenerate(
  prompt: string,
  onChunk?: (chunk: string) => void,
  onDone?: () => void,
  onError?: (err: Error) => void
): Promise<void> {
  try {
    const plan = await generateLocalPlan(prompt);
    // Serialize to JSON and split into chunk pieces to mimic streaming
    const json = JSON.stringify(plan);
    // Split into ~80-char chunks
    const chunkSize = 80;
    for (let i = 0; i < json.length; i += chunkSize) {
      const piece = json.slice(i, i + chunkSize);
      // replace newlines with escaped form so frontend's replace(/\\n/g,"\n") works
      const safe = piece.replace(/\n/g, "\\n");
      onChunk?.(safe);
      // small delay between chunks to mimic streaming
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 60));
    }
    // Finally signal done; frontend expects onDone to be called when stream complete
    onDone?.();
  } catch (err: any) {
    try {
      onError?.(err);
    } catch {}
  }
}

export default {
  generateLocalPlan,
  streamLocalGenerate,
};

