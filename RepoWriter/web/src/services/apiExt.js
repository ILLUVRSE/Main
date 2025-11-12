/**
 * apiExt.ts
 *
 * Extension helpers for the web client to call new server endpoints:
 *  - POST /api/openai/validate
 *  - GET  /api/history
 *  - POST /api/history/rollback
 *
 * These functions are thin wrappers around fetch with JSON handling and
 * consistent error shaping.
 */
function parseJsonResponse(res) {
    return res.text().then((t) => {
        try {
            return JSON.parse(t);
        }
        catch {
            throw new Error(`Invalid JSON response: ${t}`);
        }
    });
}
export async function validatePatchesExt(patches, opts) {
    const body = { patches };
    if (opts?.testCommand)
        body.testCommand = opts.testCommand;
    if (typeof opts?.timeoutMs === "number")
        body.timeoutMs = opts.timeoutMs;
    const res = await fetch("/api/openai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server ${res.status}: ${text}`);
    }
    return parseJsonResponse(res);
}
/** Get repowriter commit history (GET /api/history) */
export async function getHistory() {
    const res = await fetch("/api/history");
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Server ${res.status}: ${t}`);
    }
    return parseJsonResponse(res);
}
/**
 * Rollback either by commitSha or by providing rollbackMetadata:
 * POST /api/history/rollback
 * body: { commitSha?: string, rollbackMetadata?: any }
 */
export async function rollbackCommitOrMetadata(args) {
    const res = await fetch("/api/history/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
    });
    const text = await res.text();
    try {
        const j = JSON.parse(text);
        if (!res.ok)
            throw new Error(j?.error || String(j) || `HTTP ${res.status}`);
        return j;
    }
    catch (err) {
        // if text isn't JSON, rethrow with raw text
        if (!res.ok)
            throw new Error(`Server ${res.status}: ${text}`);
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
}
export default {
    validatePatchesExt,
    getHistory,
    rollbackCommitOrMetadata,
};
