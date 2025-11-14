/**
 * openaiClient.ts
 *
 * Lightweight helper to call OpenAI-style chat completions and return structured JSON
 * when possible. This file makes the client more robust by adding retries, clearer
 * errors, and safer parsing of the returned content.
 *
 * Exports:
 *  - chatJson(system: string, user: string, opts?: { model?: string, retries?: number, timeoutMs?: number, responseFormat?: any })
 *
 * Notes:
 *  - Returns parsed JSON when the model returns a JSON string inside choices[0].message.content.
 *  - If parsing fails, returns { raw: content } so callers can present raw text in the UI.
 */
import { getOpenAIHeaders } from "../config.js";
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Parse model output that may be JSON string or already JSON. Return JS value or { raw }. */
function parseModelContent(content) {
    if (content === null || content === undefined)
        return { raw: "" };
    // If content already an object, return as-is
    if (typeof content === "object")
        return content;
    // If content is a string, attempt JSON.parse; if fail, return raw wrapper
    if (typeof content === "string") {
        const trimmed = content.trim();
        // Some models may return backtick-fenced JSON or text with markers; attempt to extract JSON fragment.
        // Heuristic: find first '{' and last '}' and try to parse substring.
        try {
            // Direct parse
            return JSON.parse(trimmed);
        }
        catch {
            // Try to find JSON substring
            const first = trimmed.indexOf("{");
            const last = trimmed.lastIndexOf("}");
            if (first !== -1 && last !== -1 && last > first) {
                const cand = trimmed.slice(first, last + 1);
                try {
                    return JSON.parse(cand);
                }
                catch {
                    // fallthrough
                }
            }
            // No JSON parseable; return raw wrapper so caller knows it needs inspection
            return { raw: trimmed };
        }
    }
    // Unknown type — wrap as raw
    return { raw: String(content) };
}
/**
 * chatJson
 *
 * Calls OpenAI chat completions endpoint and attempts to return a parsed JSON object.
 * On failure returns { raw: <content string> }.
 */
export async function chatJson(system, user, opts = {}) {
    const headers = getOpenAIHeaders();
    const OPENAI_BASE = process.env.OPENAI_API_URL || "https://api.openai.com";
    const model = opts.model || "gpt-4o-mini";
    const retries = typeof opts.retries === "number" ? opts.retries : 3;
    // Build request body. We will request structured JSON via response_format if caller provided,
    // but by default we do not set response_format here to maximize compatibility.
    const body = {
        model,
        temperature: 0.2,
        messages: [
            { role: "system", content: system },
            { role: "user", content: user }
        ]
    };
    if (opts.responseFormat) {
        body.response_format = opts.responseFormat;
    }
    else {
        // Historically planner expects JSON string inside choices[0].message.content, so do not force response_format.
        // Some model setups support response_format; caller may opt in via opts.responseFormat.
    }
    // Retry loop with exponential backoff for transient errors
    let attempt = 0;
    let lastErr = null;
    while (attempt < retries) {
        attempt++;
        try {
            // Diagnostic logging: show target and headers (Authorization redacted)
            try {
                const safeHeaders = Object.assign({}, headers);
                if (typeof safeHeaders.Authorization === "string") {
                    safeHeaders.Authorization = safeHeaders.Authorization.slice(0, 12) + "[REDACTED]";
                }
                console.log("[openaiClient] POST", `${OPENAI_BASE}/v1/chat/completions`);
                console.log("[openaiClient] HEADERS:", safeHeaders);
            }
            catch (e) {
                // ignore logging errors
            }
            const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
                method: "POST",
                headers,
                body: JSON.stringify(body)
            });
            const text = await res.text();
            if (!res.ok) {
                // Log response for diagnostics, but keep the original behavior
                try {
                    console.error("[openaiClient] OpenAI response:", res.status, text && (text.slice ? text.slice(0, 2000) : text));
                }
                catch { }
                // For 4xx/5xx return a helpful error including body
                throw new Error(`OpenAI HTTP ${res.status}: ${text}`);
            }
            // Try to parse response as JSON (OpenAI-style)
            let json;
            try {
                json = JSON.parse(text);
            }
            catch (err) {
                // Response not JSON — return raw
                return { raw: text };
            }
            // Extract content
            const content = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? null;
            // Parse model content into object or return raw wrapper
            const parsed = parseModelContent(content);
            return parsed;
        }
        catch (err) {
            lastErr = err;
            // If this was a client-side or server-side transient error, retry with backoff.
            // We consider 5xx or network errors retriable. If error message contains "OpenAI HTTP 4" (4xx), do not retry.
            const msg = String(err?.message || err);
            const isClientError = /OpenAI HTTP 4\d{2}/.test(msg);
            const isServerError = /OpenAI HTTP 5\d{2}/.test(msg);
            if (attempt >= retries || isClientError) {
                // no more retries
                throw new Error(`OpenAI request failed (attempt ${attempt}): ${msg}`);
            }
            // backoff
            const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
            await sleep(backoff);
            continue;
        }
    }
    throw new Error(`OpenAI request failed after ${retries} attempts: ${String(lastErr?.message || lastErr)}`);
}
export default { chatJson };
