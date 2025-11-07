import { Request, Response, NextFunction } from 'express';
import logger from '../logger';

type AnyError = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
  details?: unknown;
  errors?: unknown;
};

const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

function mapStatus(code: string | undefined, fallback?: number): number {
  switch ((code || '').toLowerCase()) {
    case 'unauthenticated':
    case 'auth.required':
      return 401;
    case 'forbidden':
    case 'policy.denied':
      return 403;
    case 'validation_error':
    case 'invalid_request':
      return 400;
    case 'conflict':
    case 'idempotency_key_conflict':
      return 409;
    default:
      return fallback && fallback >= 400 ? fallback : 500;
  }
}

export function errorHandler(err: AnyError, _req: Request, res: Response, _next: NextFunction): void {
  const code = err.code || (typeof err.message === 'string' ? err.message : undefined) || 'internal_error';
  const initialStatus = err.status ?? err.statusCode;
  const status = mapStatus(code, initialStatus);

  const details = err.details ?? err.errors;

  logger.error('request_failed', {
    code,
    status,
    message: err.message,
  });

  const body: Record<string, unknown> = {
    error: err.message || code,
    code,
  };

  if (details !== undefined) {
    body.details = details;
  }

  if (!isProduction && err.stack) {
    body.stack = err.stack.split('\n');
  }

  res.status(status).json(body);
}

export default errorHandler;

