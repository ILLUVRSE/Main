/**
 * web/src/services/api.ts
 *
 * High-level client helpers for RepoWriter web UI.
 * Updated to call the backend by absolute API base URL so the UI (served by Vite)
 * can communicate with the server running at a different origin/port.
 *
 * The API base can be changed at runtime by setting:
 *   localStorage.setItem('repowriter_api_base', 'http://localhost:7071')
 *
 * Defaults to http://localhost:7071 for local development.
 */

import llm, { Plan as LocalPlan } from "./llm";

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

type FetchPlanOpts = {
  backend?: "openai" | "local";
};

/** Resolve API base URL:
 *  - First: localStorage 'repowriter_api_base'
 *  - Fallback: http://localhost:7071
 */
function getApiBase(): string {
  try {
    const stored = localStorage.getItem("repowriter_api_base");
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return "http://localhost:7071";
}

/** Convert a relative /api/... path to absolute URL (API_BASE + path) */
function apiUrl(path: string) {
  const base = getApiBase().replace(/\/$/, "");
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
}

async function handleJsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text}`);
  }
}

function getEffectiveBackend(explicit?: "openai" | "local") {
  if (explicit) return explicit;
  const stored = (localStorage.getItem("repowriter_backend") as "openai" | "local") || "openai";
  return stored;
}

/** POST /api/openai/plan or /api/llm/local/plan if backend=local */
export async function fetchPlan(prompt: string, memory: string[] = [], opts?: FetchPlanOpts): Promise<Plan> {
  const backend = getEffectiveBackend(opts?.backend);

  if (backend === "local") {
    // Use frontend local LLM helper which calls server /api/llm/local/plan (llm.ts handles absolute URL)
    const p = await llm.generateLocalPlan(prompt);
    return p as Plan;
  }

  // OpenAI path via absolute backend URL
  const res = await fetch(apiUrl("/api/openai/plan"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, memory }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Server ${res.status}: ${txt}`);
  }
  const j = await handleJsonResponse(res);
  return (j.plan ?? j) as Plan;
}

/**
 * streamPlan: helper to call streaming endpoint and handle SSE-style `data: ...` events.
 * - If backend is "local", it will call llm.streamLocalGenerate which handles both SSE and chunked text.
 */
export async function streamPlan(
  prompt: string,
  memory: string[] = [],
  onChunk?: (chunk: string) => void,
  onDone?: () => void,
  onError?: (err: Error) => void,
  opts?: { backend?: "openai" | "local"; endpoint?: string }
): Promise<void> {
  const backend = getEffectiveBackend(opts?.backend);
  if (backend === "local") {
    // Use the llm service's streaming helper
    return llm.streamLocalGenerate(
      prompt,
      (chunk) => {
        try { onChunk?.(chunk); } catch {}
      },
      () => {
        try { onDone?.(); } catch {}
      },
      (err) => {
        try { onError?.(err); } catch {}
      }
    );
  }

  // OpenAI streaming endpoint (SSE) — use absolute URL
  const endpoint = opts?.endpoint ?? apiUrl("/api/openai/stream");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, memory }),
  });

  if (!res.ok) {
    const t = await res.text();
    onError?.(new Error(`Server ${res.status}: ${t}`));
    throw new Error(`Server ${res.status}: ${t}`);
  }

  if (!res.body) {
    const t = await res.text();
    onChunk?.(t);
    onDone?.();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        const lines = rawEvent.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            onDone?.();
            return;
          }
          const decoded = payload.replace(/\\n/g, "\n");
          onChunk?.(decoded);
        }
      }

      // newline-terminated lines
      if (buf.endsWith("\n")) {
        const lines = buf.split("\n").map((l) => l.trim()).filter(Boolean);
        buf = "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            onDone?.();
            return;
          }
          const decoded = payload.replace(/\\n/g, "\n");
          onChunk?.(decoded);
        }
      }
    }

    // trailing buffer
    if (buf.trim()) {
      const lines = buf.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          onDone?.();
          return;
        }
        const decoded = payload.replace(/\\n/g, "\n");
        onChunk?.(decoded);
      }
    }

    onDone?.();
  } catch (err: any) {
    onError?.(err);
    throw err;
  } finally {
    try { reader.cancel(); } catch {}
  }
}

/** POST /api/openai/apply */
export async function applyPatches(patches: PatchObj[], mode: "dry" | "apply" = "apply") {
  const res = await fetch(apiUrl("/api/openai/apply"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches, mode }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server ${res.status}: ${t}`);
  }
  return handleJsonResponse(res);
}

/** GET /api/repo/list?pattern=... */
export async function listRepoFiles(pattern = "**/*.*"): Promise<string[]> {
  const url = `${apiUrl("/api/repo/list")}?pattern=${encodeURIComponent(pattern)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server ${res.status}: ${t}`);
  }
  const j = await handleJsonResponse(res);
  if (Array.isArray(j)) return j;
  return j.files ?? [];
}

/** GET /api/repo/file?path=... */
export async function getRepoFile(pathParam: string): Promise<{ content: string | null }> {
  const url = `${apiUrl("/api/repo/file")}?path=${encodeURIComponent(pathParam)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server ${res.status}: ${t}`);
  }
  return handleJsonResponse(res);
}

/** Simple helper to POST /api/openai/validate (or use server validate) */
export async function validatePatches(patches: PatchObj[]) {
  const res = await fetch(apiUrl("/api/openai/validate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches }),
  });
  if (!res.ok) {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      return j;
    } catch {
      throw new Error(`Server ${res.status}: ${t}`);
    }
  }
  return handleJsonResponse(res);
}

export default {
  fetchPlan,
  streamPlan,
  applyPatches,
  listRepoFiles,
  getRepoFile,
  validatePatches,
};

