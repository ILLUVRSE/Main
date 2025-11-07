/**
 * kernel/src/logger.ts
 *
 * Structured logger emitting JSON lines for ingestion by log processors.
 * Audit events include the active traceId when available so audit streams can
 * be correlated with request traces.
 */

export interface LogMeta {
  [key: string]: unknown;
}

export interface KernelLogger {
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  audit(event: string, meta?: LogMeta): void;
}

type LogLevel = 'info' | 'warn' | 'error' | 'audit';

function nowIso(): string {
  return new Date().toISOString();
}

function resolveTraceId(meta?: LogMeta): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tracing = require('./middleware/tracing');
    if (typeof tracing.getCurrentTraceId === 'function') {
      return (meta?.traceId as string) || tracing.getCurrentTraceId() || undefined;
    }
  } catch {
    // ignore lazy require failures in environments that do not load middleware
  }
  return (meta?.traceId as string) || undefined;
}

function emitConsole(level: Exclude<LogLevel, 'audit'>, entry: Record<string, unknown>): void {
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
  // eslint-disable-next-line no-console
  (console as any)[method](JSON.stringify(entry));
}

function log(level: LogLevel, message: string, meta?: LogMeta): void {
  const { traceId: _unused, ...rest } = meta || {};
  const traceId = resolveTraceId(meta);
  const entry: Record<string, unknown> = {
    level,
    timestamp: nowIso(),
    message,
    traceId: level === 'audit' ? traceId || 'unknown' : traceId,
    ...rest,
  };

  if (level === 'audit') {
    entry.event = message;
    entry.category = 'audit';
    emitConsole('info', entry);
    return;
  }

  emitConsole(level, entry);
}

export const logger: KernelLogger = {
  info(message: string, meta?: LogMeta) {
    log('info', message, meta);
  },
  warn(message: string, meta?: LogMeta) {
    log('warn', message, meta);
  },
  error(message: string, meta?: LogMeta) {
    log('error', message, meta);
  },
  audit(event: string, meta?: LogMeta) {
    log('audit', event, meta);
  },
};

export default logger;

