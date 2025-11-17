import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

/**
 * Request logger middleware
 *
 * Logs start / finish of requests with timing, status, and minimal user info.
 * Designed to be safe for use in production: avoids logging sensitive headers/bodies.
 *
 * Usage:
 *   app.use(requestLogger());
 *
 * Options could be extended later (sampling, quiet paths, redact list).
 */
export function requestLogger() {
  return function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const id = `${start.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const user = (req as any).user;
    const userId = user?.id;
    const route = req.originalUrl || req.url;
    const method = req.method;
    const remote =
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      (req.connection && (req.connection as any).remoteAddress) ||
      'unknown';

    // Log incoming request (info level)
    logger.info('http.request.start', {
      id,
      method,
      route,
      remote,
      userId,
    });

    // On finish, log duration and status
    const onFinish = () => {
      res.removeListener('finish', onFinish);
      const durationMs = Date.now() - start;
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

      // Avoid including potentially sensitive headers/body
      const meta: any = {
        id,
        method,
        route,
        status,
        durationMs,
        remote,
        userId,
      };

      // Include rate-limit info if present
      if ((req as any)._rateLimit) {
        meta.rateLimit = (req as any)._rateLimit;
      }

      // Include referrer/ua in a limited form for diagnostics
      try {
        const ua = String(req.headers['user-agent'] || '').slice(0, 200);
        const ref = String(req.headers['referer'] || req.headers['referrer'] || '').slice(0, 200);
        if (ua) meta.userAgent = ua;
        if (ref) meta.referer = ref;
      } catch {
        // ignore header extraction errors
      }

      // Emit structured log
      if (level === 'error') logger.error('http.request.finish', meta);
      else if (level === 'warn') logger.warn('http.request.finish', meta);
      else logger.info('http.request.finish', meta);
    };

    res.on('finish', onFinish);

    // In case of unexpected errors, ensure finish is logged
    res.on('close', () => {
      // If connection closed prematurely, ensure we log
      const durationMs = Date.now() - start;
      logger.warn('http.request.closed', {
        id,
        method,
        route,
        remote,
        userId,
        durationMs,
        status: res.statusCode,
      });
    });

    next();
  };
}

export default requestLogger;

