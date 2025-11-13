/**
 * requestIdAndTiming.ts
 *
 * Middleware to attach a request id to each request (using X-Request-Id if supplied,
 * otherwise generating one), set response headers, and log timing information when
 * the response finishes.
 */

import { Request, Response, NextFunction } from "express";
import { generateRequestId, logInfo, logError, logWarn } from "../telemetry/logger";

export function requestIdAndTiming(req: Request, res: Response, next: NextFunction) {
  try {
    const incoming = (req.headers["x-request-id"] as string) || "";
    const id = incoming.trim() || generateRequestId();
    (res.locals as any).requestId = id;
    try {
      res.setHeader("X-Request-Id", id);
    } catch { /** ignore header errors */ }

    const start = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - start;
      try {
        res.setHeader("X-Response-Time", `${durationMs}ms`);
      } catch {
        // ignore if headers already sent
      }

      const meta = {
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs,
        requestId: id,
        remoteAddr: req.ip || (req.socket && req.socket.remoteAddress) || null,
      };

      try {
        logInfo(`req ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms) ${JSON.stringify(meta)}`);
      } catch (e) {
        // swallow logging errors
      }
    });

    res.on("error", (err: any) => {
      try {
        logError(`response error: ${String(err?.message || err)} requestId=${id}`);
      } catch {
        // ignore
      }
    });
  } catch (err: any) {
    try {
      logError(`requestIdAndTiming middleware failed: ${String(err?.message || err)}`);
    } catch {
      // ignore
    }
  }

  next();
}

export default requestIdAndTiming;
