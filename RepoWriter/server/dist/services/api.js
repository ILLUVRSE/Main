/**
 * server/src/services/api.ts
 *
 * Lightweight server-side copy of the web client api helper used by some server-side
 * utilities and tests. This file intentionally keeps a small, pragmatic surface:
 * - Uses fetch to call internal endpoints
 * - Provides a local-llm streaming helper by delegating to the server-side llm adapter
 *
 * NOTE: this file is used by server-side CLI/tools/tests and intentionally mirrors
 * the client helpers (but lives on the server).
 */
import llm from "./llm";
/** Resolve API base URL for server-side helpers.
 * Default is http://localhost:7071
 */
function getApiBase() {
    return process.env.REPOWRITER_API_BASE || "http://localhost:7071";
}
function apiUrl(pathStr) {
    const base = getApiBase().replace(/\/$/, "");
    if (pathStr.startsWith("/"))
        return `${base}${pathStr}`;
    return `${base}/${pathStr}`;
}
async function handleJsonResponse(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`Invalid JSON response: ${text}`);
    }
}
/** fetchPlan: call /api/openai/plan (or use local llm when backend=local) */
export async function fetchPlan(prompt, memory = [], opts) {
    const backend = opts?.backend ?? "openai";
    if (backend === "local") {
        const p = await llm.generateLocalPlan(prompt);
        return p;
    }
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
    return (j.plan ?? j);
}
/**
 * streamPlan: helper to call streaming endpoint and handle SSE-style `data: ...` events.
 * - If backend is "local", it will call llm.streamLocalGenerate which handles both SSE and chunked text.
 */
export async function streamPlan(prompt, memory = [], onChunk, onDone, onError, opts) {
    const backend = opts?.backend ?? "openai";
    if (backend === "local") {
        // Defensive cast: llm default export may be an object; ensure streamLocalGenerate is invoked.
        // Provide explicit parameter types for callbacks to satisfy TypeScript.
        return llm.streamLocalGenerate(prompt, (chunk) => {
            try {
                onChunk?.(chunk);
            }
            catch { }
        }, () => {
            try {
                onDone?.();
            }
            catch { }
        }, (err) => {
            try {
                onError?.(err);
            }
            catch { }
        });
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
    const reader = res.body.getReader ? res.body.getReader() : null;
    const decoder = new TextDecoder();
    let buf = "";
    if (reader) {
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                buf += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buf.indexOf("\n\n")) !== -1) {
                    const rawEvent = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);
                    const lines = rawEvent.split("\n").map((l) => l.trim()).filter(Boolean);
                    for (const line of lines) {
                        if (!line.startsWith("data:"))
                            continue;
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
                        if (!line.startsWith("data:"))
                            continue;
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
                    if (!line.startsWith("data:"))
                        continue;
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
        }
        catch (err) {
            onError?.(err);
            throw err;
        }
        finally {
            try {
                reader.releaseLock?.();
            }
            catch { }
        }
        return;
    }
    // Fallback: use reader-less consumption (Node stream or string)
    const streamReader = res.body;
    try {
        for await (const chunk of streamReader) {
            const decoded = typeof chunk === "string" ? chunk : decoder.decode(chunk);
            onChunk?.(decoded);
        }
        onDone?.();
    }
    catch (err) {
        onError?.(err);
        throw err;
    }
}
/** POST /api/openai/apply */
export async function applyPatches(patches, mode = "apply") {
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
export async function listRepoFiles(pattern = "**/*.*") {
    const url = `${apiUrl("/api/repo/list")}?pattern=${encodeURIComponent(pattern)}`;
    const res = await fetch(url);
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Server ${res.status}: ${t}`);
    }
    const j = await handleJsonResponse(res);
    if (Array.isArray(j))
        return j;
    return j.files ?? [];
}
/** GET /api/repo/file?path=... */
export async function getRepoFile(pathParam) {
    const url = `${apiUrl("/api/repo/file")}?path=${encodeURIComponent(pathParam)}`;
    const res = await fetch(url);
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Server ${res.status}: ${t}`);
    }
    return handleJsonResponse(res);
}
/** Simple helper to POST /api/openai/validate (server validates in sandbox) */
export async function validatePatches(patches, options) {
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
        }
        catch {
            throw new Error(`Server ${res.status}: ${t}`);
        }
    }
    return handleJsonResponse(res);
}
/** Repo helpers: branch-commit, push, pr */
export async function branchCommit(branchName, files, commitMessage, opts) {
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
export async function pushRepo(branch, remote) {
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
export async function createPR(params) {
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
export async function getContext(prompt, options) {
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
        }
        catch {
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
