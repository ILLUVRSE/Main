/**
 * ensureOpenAIKey.ts (updated)
 *
 * Middleware that blocks "heavy" endpoints that require a real OpenAI API key
 * when none is configured. This protects accidental calls to production OpenAI
 * without a key and provides a clear error message.
 *
 * Behavior:
 *  - If process.env.OPENAI_API_KEY is set -> allow.
 *  - If process.env.OPENAI_API_URL points to a localhost/mock (127.0.0.1 or localhost) -> allow.
 *  - If process.env.REPOWRITER_ALLOW_NO_KEY === "1" -> allow (developer override).
 *  - If process.env.SANDBOX_ENABLED === "1" -> allow (CI/local mode where sandbox/mock is used).
 *  - Otherwise -> respond 503 with an explanatory JSON payload.
 *
 * IMPORTANT: This version is fail-closed. If the middleware itself errors, it
 * will refuse the request (503) and log a warning. This avoids silently allowing
 * potentially dangerous operations when checks fail.
 */
import { logWarn } from "../telemetry/logger.js";
export function ensureOpenAIKey(req, res, next) {
    try {
        const key = process.env.OPENAI_API_KEY;
        const base = (process.env.OPENAI_API_URL || "").trim();
        const allowFlag = process.env.REPOWRITER_ALLOW_NO_KEY === "1";
        const sandboxEnabled = process.env.SANDBOX_ENABLED === "1";
        // Allow if explicit override
        if (allowFlag) {
            return next();
        }
        // Allow if explicit key present
        if (key && key.length > 0) {
            return next();
        }
        // Allow if OPENAI_API_URL points to a local mock (localhost or 127.0.0.1)
        if (base) {
            const lower = base.toLowerCase();
            if (lower.includes("localhost") || lower.includes("127.0.0.1")) {
                return next();
            }
        }
        // Allow if sandbox mode explicitly enabled (CI / dev mode). This permits calling endpoints
        // when a sandbox / mock is used instead of real OpenAI.
        if (sandboxEnabled) {
            // Warn if SANDBOX_ENABLED but no known sandbox runner config present (helpful diag)
            const sandboxImage = process.env.SANDBOX_IMAGE || process.env.SANDBOX_COMMAND || process.env.SANDBOX_DOCKER_IMAGE;
            if (!sandboxImage) {
                try {
                    console.warn("[ensureOpenAIKey] SANDBOX_ENABLED=1 but no SANDBOX_IMAGE/SANDBOX_COMMAND configured; ensure your sandbox runner is configured.");
                }
                catch { }
            }
            return next();
        }
        // Otherwise, refuse with actionable error
        const msg = "OPENAI_API_KEY is not configured. This endpoint requires an OpenAI API key or a local OPENAI_API_URL (mock). " +
            "Set OPENAI_API_KEY in RepoWriter/server/.env or set OPENAI_API_URL to your local mock (http://127.0.0.1:9876). " +
            "For development only, set REPOWRITER_ALLOW_NO_KEY=1 to bypass this check. " +
            "Alternatively, to enable CI/local sandbox mode set SANDBOX_ENABLED=1 and configure your sandbox runner (SANDBOX_IMAGE or SANDBOX_COMMAND).";
        // Log the warning
        try {
            logWarn(req, "ensureOpenAIKey: blocking request due to missing OpenAI key");
        }
        catch {
            try {
                console.warn("[ensureOpenAIKey] blocking request due to missing OpenAI key");
            }
            catch { }
        }
        return res.status(503).json({ ok: false, error: msg });
    }
    catch (err) {
        // Fail-closed: do not allow requests if middleware fails. Log and return 503.
        try {
            logWarn(req, `ensureOpenAIKey middleware error: ${String(err?.message || err)}`);
        }
        catch { }
        return res.status(503).json({ ok: false, error: "ensureOpenAIKey middleware failed (see server logs)." });
    }
}
export default ensureOpenAIKey;
