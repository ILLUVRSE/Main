/**
 * src/telemetry/logger.ts
 *
 * TypeScript telemetry/logger shim for RepoWriter.
 *
 * Changes:
 * - Redact sensitive headers (authorization, cookie, set-cookie, x-api-key)
 *   when extracting request metadata to avoid logging secrets.
 *
 * Keep the same public surface as before.
 */
export function generateRequestId(prefix = "") {
    const rnd = Math.random().toString(36).slice(2, 10);
    return prefix ? `${prefix}-${rnd}` : rnd;
}
function redactHeaders(hdrs) {
    if (!hdrs || typeof hdrs !== "object")
        return {};
    const out = {};
    const sensitive = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "x-access-token"]);
    for (const [k, v] of Object.entries(hdrs)) {
        const key = String(k || "").toLowerCase();
        if (sensitive.has(key)) {
            out[key] = "[REDACTED]";
        }
        else {
            out[key] = v;
        }
    }
    return out;
}
function extractReqMeta(reqOrMeta) {
    if (!reqOrMeta)
        return {};
    try {
        if (typeof reqOrMeta === "object" && (reqOrMeta.method || reqOrMeta.url || reqOrMeta.path)) {
            // Normalized request metadata
            const ip = reqOrMeta.ip ||
                (reqOrMeta.headers &&
                    (reqOrMeta.headers["x-forwarded-for"] || reqOrMeta.headers["X-Forwarded-For"])) ||
                reqOrMeta.socket?.remoteAddress ||
                reqOrMeta.connection?.remoteAddress;
            const ua = reqOrMeta.headers && (reqOrMeta.headers["user-agent"] || reqOrMeta.headers["User-Agent"]);
            const pathVal = reqOrMeta.url || reqOrMeta.path;
            const hdrs = redactHeaders(reqOrMeta.headers || {});
            // Return compact meta
            return {
                method: reqOrMeta.method,
                path: pathVal,
                ip,
                userAgent: ua,
                headers: hdrs
            };
        }
    }
    catch {
        // ignore and fall through
    }
    if (typeof reqOrMeta === "object")
        return reqOrMeta;
    return { meta: String(reqOrMeta) };
}
function formatMsg(level, meta, msg) {
    const ts = new Date().toISOString();
    let metaStr = "";
    try {
        metaStr = meta && Object.keys(meta).length ? JSON.stringify(meta) : "";
    }
    catch {
        metaStr = String(meta);
    }
    return `[${ts}] [${level}] ${msg}${metaStr ? " | " + metaStr : ""}`;
}
/**
 * normalizeLoggerArgs
 *
 * Accepts the flexible call shapes and returns { meta, msg }.
 *
 * Supported invocation forms:
 *  - fn(req, msg, meta)
 *  - fn(msg, meta)
 *  - fn(req, msg)
 *  - fn(msg)
 *  - fn(req) // logs req metadata with empty message
 */
function normalizeLoggerArgs(arg1, arg2, arg3) {
    // If arg3 present: arg1=reqOrMeta, arg2=msg, arg3=meta
    if (arg3 !== undefined) {
        const meta = Object.assign({}, extractReqMeta(arg1), (arg3 || {}));
        const msg = String(arg2 ?? "");
        return { meta, msg };
    }
    // If arg2 present and arg1 is object or request-like and arg2 is object => treat as (msg, meta)
    if (arg2 !== undefined) {
        // If arg1 looks like a request/object with method/url -> treat as (req, msg)
        if (arg1 && typeof arg1 === "object" && (arg1.method || arg1.url || arg1.path)) {
            return { meta: extractReqMeta(arg1), msg: String(arg2 ?? "") };
        }
        // Else treat as (msg, meta)
        return { meta: (arg2 && typeof arg2 === "object") ? arg2 : {}, msg: String(arg1 ?? "") };
    }
    // Only one argument provided:
    if (arg1 !== undefined) {
        if (typeof arg1 === "object") {
            return { meta: extractReqMeta(arg1), msg: "" };
        }
        // arg1 is primitive => message
        return { meta: {}, msg: String(arg1) };
    }
    // No args
    return { meta: {}, msg: "" };
}
/**
 * logInfo
 */
export function logInfo(arg1, arg2, arg3) {
    const { meta, msg } = normalizeLoggerArgs(arg1, arg2, arg3);
    // eslint-disable-next-line no-console
    console.info(formatMsg("INFO", meta, msg));
}
/**
 * logWarn
 */
export function logWarn(arg1, arg2, arg3) {
    const { meta, msg } = normalizeLoggerArgs(arg1, arg2, arg3);
    // eslint-disable-next-line no-console
    console.warn(formatMsg("WARN", meta, msg));
}
/**
 * logError
 */
export function logError(arg1, arg2, arg3) {
    const { meta, msg } = normalizeLoggerArgs(arg1, arg2, arg3);
    // eslint-disable-next-line no-console
    console.error(formatMsg("ERROR", meta, msg));
}
export default { generateRequestId, logInfo, logWarn, logError };
