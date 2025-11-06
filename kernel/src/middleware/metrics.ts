import { NextFunction, Request, Response } from 'express';
import { observeHttpRequest } from '../metrics/prometheus';

function getRouteLabel(req: Request): string {
  const routePath = (req.route && req.route.path) || '';
  if (routePath) {
    return `${req.baseUrl || ''}${routePath}` || routePath;
  }
  const url = req.originalUrl || req.url || req.path;
  return url ? url.split('?')[0] : 'unknown';
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1_000_000_000;
    const method = req.method;
    const route = getRouteLabel(req);
    const statusCode = res.statusCode;

    observeHttpRequest({
      method,
      route,
      statusCode,
      durationSeconds,
    });
  });

  next();
}

