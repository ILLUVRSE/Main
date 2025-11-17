import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

/**
 * Simple in-memory rate limiter middleware.
 *
 * Designed for development and small deployments. For production, replace with a distributed
 * store (Redis) backed limiter. This implementation supports per-key limits with a sliding
 * window implemented via token-bucket like logic.
 *
 * Usage:
 *   app.use(rateLimit({ windowMs: 60_000, max: 100 }));
 *
 * Options:
 *  - windowMs: number - length of window in milliseconds (default: 60_000)
 *  - max: number - max requests per window per key (default: 120)
 *  - keyFn: (req) => string - function to derive the key (default: ip or user id)
 *  - skipFailedRequests: boolean - don't count requests that result in non-2xx (default: false)
 */
type RateLimitOptions = {
  windowMs?: number;
  max?: number;
  keyFn?: (req: Request) => string;
  skipFailedRequests?: boolean;
  // optional: allow burst capacity > max (not implemented explicitly)
};

type Bucket = {
  lastRefill: number;
  tokens: number;
};

const DEFAULT_WINDOW = 60_000;
const DEFAULT_MAX = 120;

function nowMs() {
  return Date.now();
}

export function rateLimit(opts: RateLimitOptions = {}) {
  const windowMs = Number(opts.windowMs ?? DEFAULT_WINDOW);
  const max = Number(opts.max ?? DEFAULT_MAX);
  const keyFn = opts.keyFn ?? ((req: Request) => {
    // Prefer authenticated user id then IP
    const user = (req as any).user;
    if (user && user.id) return `user:${user.id}`;
    // fallback to ip + route base to reduce cross-endpoint abuse
    const ip = (req.ip || (req.headers['x-forwarded-for'] as string) || req.connection?.remoteAddress || 'unknown').toString();
    return `ip:${ip}`;
  });
  const skipFailed = Boolean(opts.skipFailedRequests ?? false);

  // In-memory buckets map
  const buckets = new Map<string, Bucket>();

  // Periodic cleanup to prevent memory leak: remove buckets not used for > 2 * windowMs
  const CLEANUP_INTERVAL = Math.max(30_000, Math.floor(windowMs * 2));
  const STALE_THRESHOLD = windowMs * 2;
  const cleanupTimer = setInterval(() => {
    try {
      const now = nowMs();
      for (const [k, b] of Array.from(buckets.entries())) {
        if (now - b.lastRefill > STALE_THRESHOLD) {
          buckets.delete(k);
        }
      }
    } catch (err) {
      // don't allow cleanup errors to crash app
      logger.warn('rateLimit.cleanup.failed', { err });
    }
  }, CLEANUP_INTERVAL).unref?.();

  function getBucketForKey(key: string): Bucket {
    let b = buckets.get(key);
    const now = nowMs();
    if (!b) {
      b = { lastRefill: now, tokens: max };
      buckets.set(key, b);
      return b;
    }

    // Refill tokens based on elapsed time proportional to window
    const elapsed = Math.max(0, now - b.lastRefill);
    if (elapsed > 0) {
      // tokens to add: fraction of window elapsed * max
      const refillTokens = (elapsed / windowMs) * max;
      b.tokens = Math.min(max, b.tokens + refillTokens);
      b.lastRefill = now;
    }
    return b;
  }

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      const key = keyFn(req) || 'anon';
      const bucket = getBucketForKey(key);

      // If there are at least 1 token allow request and decrement
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        // attach some debug info for observability (non-sensitive)
        (req as any)._rateLimit = { remaining: Math.floor(bucket.tokens), limit: max, windowMs };
      } else {
        // Rate limited
        const retryAfterSec = Math.ceil(windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({ ok: false, error: 'rate limit exceeded' });
        return;
      }

      if (skipFailed) {
        // If skipFailedRequests is true, we only decrement token on successful responses.
        // To implement that we restored one token and will decrement only if status < 400.
        // But because we already decremented above, we implement "compensate" behavior:
        // On finish we check status; if >=400 we add back 1 token.
        const onFinish = () => {
          res.removeListener('finish', onFinish);
          // Node may call finish multiple times - guard
          try {
            if (res.statusCode >= 400) {
              // restore token
              bucket.tokens = Math.min(max, bucket.tokens + 1);
            }
          } catch (err) {
            logger.warn('rateLimit.restoreToken.failed', { err });
          }
        };
        res.on('finish', onFinish);
      }

      next();
    } catch (err) {
      // fail-open: if limiter errors, allow requests to proceed but log
      logger.warn('rateLimit.middleware.error', { err });
      next();
    }
  };
}

export default rateLimit;

