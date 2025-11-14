/**
 * rateLimit.ts
 *
 * Simple in-memory per-IP rate limiting middleware for Express.
 * - Default: 60 requests per 60_000 ms (1 minute)
 * - Honors X-Forwarded-For if present (useful behind proxies)
 * - Sets standard headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After
 *
 * NOTE: In-memory limits are fine for local/dev and small deployments; for multi-instance
 * production use a shared store (Redis).
 */

import { Request, Response, NextFunction } from "express";

type Entry = {
  count: number;
  resetAt: number;
};

export interface RateLimitOptions {
  windowMs?: number; // milliseconds
  max?: number; // max requests per window
  cleanupIntervalMs?: number; // how often to cleanup old entries
}

/** Default configuration */
const DEFAULT_WINDOW_MS = Number(process.env.REPOWRITER_RATE_LIMIT_WINDOW_MS) || 60_000;
const DEFAULT_MAX = Number(process.env.REPOWRITER_RATE_LIMIT_MAX) || 60;
const DEFAULT_CLEANUP_MS = 60_000 * 5;

export function rateLimitMiddleware(opts?: RateLimitOptions) {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const max = opts?.max ?? DEFAULT_MAX;
  const cleanupIntervalMs = opts?.cleanupIntervalMs ?? DEFAULT_CLEANUP_MS;

  const store: Map<string, Entry> = new Map();

  // Periodic cleanup to avoid unbounded memory growth
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt + windowMs < now) {
        store.delete(key);
      }
    }
  }, cleanupIntervalMs).unref?.();

  return function (req: Request, res: Response, next: NextFunction) {
    try {
      // Derive client id (prefer X-Forwarded-For if behind proxy)
      const xf = req.headers["x-forwarded-for"];
      const ip = (typeof xf === "string" ? xf.split(",")[0].trim() : (req.ip || req.socket.remoteAddress || "unknown"));

      const now = Date.now();
      let entry = store.get(ip);
      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
      }

      entry.count += 1;
      store.set(ip, entry);

      const remaining = Math.max(0, max - entry.count);

      // Standard headers
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));

      if (entry.count > max) {
        return res.status(429).json({ error: "rate limit exceeded", retry_after_seconds: retryAfterSec });
      }

      next();
    } catch (err) {
      // On any unexpected failure, allow the request (fail-open) but log the issue server-side.
      console.warn("[rateLimit] middleware error:", err);
      next();
    }
  };
}

export default rateLimitMiddleware;

