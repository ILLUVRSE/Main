/**
 * logger.js
 *
 * Lightweight telemetry/logger shim for RepoWriter.
 *
 * Exports:
 *   - logInfo(reqOrMeta?, msg)
 *   - logWarn(reqOrMeta?, msg)
 *   - logError(reqOrMeta?, msg)
 *
 * Accepts either an Express `req` object (reads method/path and some headers) or a plain metadata object.
 * Currently just prints to console; adapt to your telemetry backend later.
 */

function extractReqMeta(reqOrMeta) {
  if (!reqOrMeta) return {};
  // If this looks like an Express request (has method and url), extract simple metadata
  try {
    if (reqOrMeta && typeof reqOrMeta === "object" && reqOrMeta.method && (reqOrMeta.url || reqOrMeta.path)) {
      return {
        method: reqOrMeta.method,
        path: reqOrMeta.url || reqOrMeta.path,
        ip: reqOrMeta.ip || (reqOrMeta.headers && reqOrMeta.headers["x-forwarded-for"]) || undefined,
        userAgent: reqOrMeta.headers && (reqOrMeta.headers["user-agent"] || reqOrMeta.headers["User-Agent"])
      };
    }
  } catch {}
  // Otherwise return shallow copy of object
  if (typeof reqOrMeta === "object") return reqOrMeta;
  return { meta: String(reqOrMeta) };
}

function formatMsg(level, meta, msg) {
  const ts = new Date().toISOString();
  let metaStr = "";
  try {
    metaStr = meta && Object.keys(meta).length ? JSON.stringify(meta) : "";
  } catch {
    metaStr = String(meta);
  }
  return `[${ts}] [${level}] ${msg}${metaStr ? " | " + metaStr : ""}`;
}

export function logInfo(reqOrMeta, msg) {
  const meta = extractReqMeta(reqOrMeta);
  // eslint-disable-next-line no-console
  console.info(formatMsg("INFO", meta, msg || ""));
}

export function logWarn(reqOrMeta, msg) {
  const meta = extractReqMeta(reqOrMeta);
  // eslint-disable-next-line no-console
  console.warn(formatMsg("WARN", meta, msg || ""));
}

export function logError(reqOrMeta, msg) {
  const meta = extractReqMeta(reqOrMeta);
  // eslint-disable-next-line no-console
  console.error(formatMsg("ERROR", meta, msg || ""));
}

export default { logInfo, logWarn, logError };

