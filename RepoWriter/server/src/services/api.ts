/**
 * web/src/services/api.ts (updated)
 *
 * Extends the existing RepoWriter client helpers with:
 *  - validatePatches(patches)
 *  - pushRepo / createPR
 *  - getContext(prompt, options)
 *
 * Keeps fetchPlan / streamPlan / applyPatches / listRepoFiles / getRepoFile behavior,
 * and supports local LLM fallback as before.
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
function apiUrl(pathStr: string) {
  const base = getApiBase().replace(/\/$/, "");
  if (pathStr.startsWith("/")) return `${base}${pathStr}`;
  return `${base}/${pathStr}`;
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

/** Simple helper to POST /api/openai/validate (server validates in sandbox) */
export async function validatePatches(patches: PatchObj[], options?: Record<string, any>) {
  const res = await fetch(apiUrl("/api/openai/validate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches, options }),
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

/** Repo helpers: branch-commit, push, pr */
export async function branchCommit(branchName: string, files: string[], commitMessage: string, opts?: { authorName?: string; authorEmail?: string }) {
  const res = await fetch(apiUrl("/api/repo/branch-commit"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branchName, files, commitMessage, authorName: opts?.authorName, authorEmail: opts?.authorEmail })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server ${res.status}: ${t}`);
  }
  return handleJsonResponse(res);
}

export async function pushRepo(branch: string, remote?: string) {
  const res = await fetch(apiUrl("/api/repo/push"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, remote })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server ${res.status}: ${t}`);
  }
  return handleJsonResponse(res);
}

/**
 * createPR: apply patches or commit existing files and open PR
 * Body mirrors server /api/repo/pr
 */
export async function createPR(params: {
  branchName: string;
  patches?: PatchObj[];
  files?: string[];
  commitMessage: string;
  prBase?: string;
  prTitle?: string;
  prBody?: string;
  pushRemote?: string;
  authorName?: string;
  authorEmail?: string;
  token?: string;
}) {
  const res = await fetch(apiUrl("/api/repo/pr"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server ${res.status}: ${t}`);
  }
  return handleJsonResponse(res);
}

/** POST /api/context/build */
export async function getContext(prompt: string, options?: Record<string, any>) {
  const res = await fetch(apiUrl("/api/context/build"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, options })
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
  const j = await handleJsonResponse(res);
  return j;
}

export default {
  fetchPlan,
  streamPlan,
  applyPatches,
  listRepoFiles,
  getRepoFile,
  validatePatches,
  branchCommit,
  pushRepo,
  createPR,
  getContext
};

