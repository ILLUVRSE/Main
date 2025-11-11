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

async function handleJsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text}`);
  }
}

/** POST /api/openai/plan */
export async function fetchPlan(prompt: string, memory: string[] = []): Promise<Plan> {
  const res = await fetch("/api/openai/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, memory }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Server ${res.status}: ${txt}`);
  }
  const j = await handleJsonResponse(res);
  // server may return { plan } or the plan root
  return (j.plan ?? j) as Plan;
}

/**
 * streamPlan: helper to call streaming endpoint and handle SSE-style `data: ...` events.
 * onChunk receives raw string payloads (server escapes newlines as \\n).
 */
export async function streamPlan(
  prompt: string,
  memory: string[] = [],
  onChunk?: (chunk: string) => void,
  onDone?: () => void,
  onError?: (err: Error) => void,
  endpoint = "/api/openai/stream"
): Promise<void> {
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
          // server encodes newlines as \n; restore them
          const decoded = payload.replace(/\\n/g, "\n");
          onChunk?.(decoded);
        }
      }

      // process remaining newline-terminated lines
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

    // process trailing buffer
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
    try {
      reader.cancel();
    } catch {}
  }
}

/** POST /api/openai/apply */
export async function applyPatches(patches: PatchObj[], mode: "dry" | "apply" = "apply") {
  const res = await fetch("/api/openai/apply", {
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
  const url = `/api/repo/list?pattern=${encodeURIComponent(pattern)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server ${res.status}: ${t}`);
  }
  const j = await handleJsonResponse(res);
  // Expect { files: string[] } or raw array
  if (Array.isArray(j)) return j;
  return j.files ?? [];
}

/** GET /api/repo/file?path=... */
export async function getRepoFile(pathParam: string): Promise<{ content: string | null }> {
  const url = `/api/repo/file?path=${encodeURIComponent(pathParam)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server ${res.status}: ${t}`);
  }
  return handleJsonResponse(res);
}

/** Simple helper to POST /api/openai/validate (may return 501 until implemented) */
export async function validatePatches(patches: PatchObj[]) {
  const res = await fetch("/api/openai/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches }),
  });
  if (!res.ok) {
    const t = await res.text();
    // the server may return 501 for not implemented; still return the JSON body if present
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
  validatePatches
};

