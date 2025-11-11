/**
 * logger.ts
 *
 * Minimal structured logger and request-id middleware for RepoWriter.
 * - requestIdMiddleware attaches X-Request-Id to responses and res.locals.requestId.
 * - logger exposes info/warn/error helpers that include timestamp and request id when available.
 *
 * This is intentionally dependency-free and small; swap in a full-featured logger (pino/winston)
 * later if you want structured outputs or JSON logs.
 */

import { Request, Response, NextFunction } from "express";

export function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Attach a request id for tracing and set the header. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const headerId = (req.headers["x-request-id"] as string) || "";
    const id = headerId.trim() || generateRequestId();
    // expose on res.locals so other code can use it without modifying Request type
    (res.locals as any).requestId = id;
    res.setHeader("X-Request-Id", id);
  } catch (err) {
    // fail-open: don't block requests if middleware errors
    console.warn("[requestIdMiddleware] failed to set request id", err);
  }
  next();
}

function formatMessage(level: string, requestId: string | undefined, msg: string, meta?: any) {
  const ts = new Date().toISOString();
  const idPart = requestId ? ` [${requestId}]` : "";
  const metaPart = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] [${level.toUpperCase()}]${idPart} ${msg}${metaPart}`;
}

/** Generic logger that optionally accepts an Express Request or Response to pull a request id. */
export function logInfo(reqOrMsg: Request | string, maybeMsg?: string, meta?: any) {
  if (typeof reqOrMsg === "string") {
    console.info(formatMessage("info", undefined, reqOrMsg, maybeMsg));
  } else {
    const id = (reqOrMsg.res && (reqOrMsg.res as any).locals?.requestId) || (reqOrMsg.headers && (reqOrMsg.headers["x-request-id"] as string));
    const msg = maybeMsg || "";
    console.info(formatMessage("info", id, msg, meta));
  }
}

export function logWarn(reqOrMsg: Request | string, maybeMsg?: string, meta?: any) {
  if (typeof reqOrMsg === "string") {
    console.warn(formatMessage("warn", undefined, reqOrMsg, maybeMsg));
  } else {
    const id = (reqOrMsg.res && (reqOrMsg.res as any).locals?.requestId) || (reqOrMsg.headers && (reqOrMsg.headers["x-request-id"] as string));
    const msg = maybeMsg || "";
    console.warn(formatMessage("warn", id, msg, meta));
  }
}

export function logError(reqOrMsg: Request | string, maybeMsg?: string, meta?: any) {
  if (typeof reqOrMsg === "string") {
    console.error(formatMessage("error", undefined, reqOrMsg, maybeMsg));
  } else {
    const id = (reqOrMsg.res && (reqOrMsg.res as any).locals?.requestId) || (reqOrMsg.headers && (reqOrMsg.headers["x-request-id"] as string));
    const msg = maybeMsg || "";
    console.error(formatMessage("error", id, msg, meta));
  }
}

export default {
  requestIdMiddleware,
  generateRequestId,
  info: logInfo,
  warn: logWarn,
  error: logError
};

