/**
 * web/src/services/llm.ts
 *
 * Client-side helper for local LLM usage.
 *
 * Exports:
 *  - generateLocalPlan(prompt: string): Promise<any>       // returns plan-like object or { raw: "..." }
 *  - streamLocalGenerate(prompt: string, onChunk, onDone, onError): Promise<void>
 *
 * The streaming helper accepts callbacks and supports SSE-style `data: ...` events or
 * chunked text. It is intentionally tolerant to different local LLM adapters.
 */
function getApiBase() {
    try {
        const stored = localStorage.getItem("repowriter_api_base");
        if (stored && stored.trim())
            return stored.trim();
    }
    catch {
        /* ignore */
    }
    return "http://localhost:7071";
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
        return text;
    }
}
/** generateLocalPlan: calls server /api/llm/local/plan to generate a plan synchronously */
export async function generateLocalPlan(prompt) {
    const url = apiUrl("/api/llm/local/plan");
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Local LLM server ${res.status}: ${txt}`);
    }
    const parsed = await handleJsonResponse(res);
    // The endpoint may return a plan-like object or { raw: "..." }
    return parsed;
}
/**
 * streamLocalGenerate
 *
 * Streams a prompt to /api/llm/local/stream and calls onChunk for each chunk,
 * onDone when finished, and onError on error.
 *
 * Supports both SSE-style `data: ...` events and plain chunked text.
 */
export async function streamLocalGenerate(prompt, onChunk, onDone, onError) {
    const url = apiUrl("/api/llm/local/stream");
    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt })
        });
    }
    catch (err) {
        onError?.(new Error(`Local LLM fetch failed: ${String(err?.message || err)}`));
        throw err;
    }
    if (!res.ok) {
        const txt = await res.text();
        const err = new Error(`Local LLM server ${res.status}: ${txt}`);
        onError?.(err);
        throw err;
    }
    if (!res.body) {
        const txt = await res.text();
        try {
            onChunk?.(txt);
        }
        catch { }
        onDone?.();
        return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            // SSE-style events separated by double-newline
            let idx;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
                const rawEvent = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                const lines = rawEvent.split("\n").map((l) => l.trim()).filter(Boolean);
                for (const line of lines) {
                    if (line.startsWith("data:")) {
                        const payload = line.slice(5).trim();
                        if (!payload)
                            continue;
                        if (payload === "[DONE]") {
                            onDone?.();
                            return;
                        }
                        const decoded = payload.replace(/\\n/g, "\n");
                        try {
                            onChunk?.(decoded);
                        }
                        catch { }
                    }
                    else {
                        // non-data SSE line
                        try {
                            onChunk?.(line);
                        }
                        catch { }
                    }
                }
            }
            // newline-terminated single-line events (defensive)
            if (buf.endsWith("\n")) {
                const lines = buf.split("\n").map((l) => l.trim()).filter(Boolean);
                buf = "";
                for (const line of lines) {
                    if (line.startsWith("data:")) {
                        const payload = line.slice(5).trim();
                        if (payload === "[DONE]") {
                            onDone?.();
                            return;
                        }
                        const decoded = payload.replace(/\\n/g, "\n");
                        try {
                            onChunk?.(decoded);
                        }
                        catch { }
                    }
                    else {
                        try {
                            onChunk?.(line);
                        }
                        catch { }
                    }
                }
            }
        }
        // trailing buffer
        if (buf.trim()) {
            const lines = buf.split("\n").map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
                if (line.startsWith("data:")) {
                    const payload = line.slice(5).trim();
                    if (payload === "[DONE]") {
                        onDone?.();
                        return;
                    }
                    const decoded = payload.replace(/\\n/g, "\n");
                    try {
                        onChunk?.(decoded);
                    }
                    catch { }
                }
                else {
                    try {
                        onChunk?.(line);
                    }
                    catch { }
                }
            }
        }
        onDone?.();
    }
    catch (err) {
        onError?.(new Error(String(err?.message || err)));
        throw err;
    }
    finally {
        try {
            reader.cancel();
        }
        catch { }
    }
}
export default { generateLocalPlan, streamLocalGenerate };
