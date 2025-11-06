/**
 * kernel/src/logger.ts
 *
 * Lightweight structured logger used across the Kernel service.
 * Provides .info/.warn/.error plus .audit for security/audit events.
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

function log(level: 'info' | 'warn' | 'error', message: string, meta?: LogMeta) {
  const payload = meta ? { message, ...meta } : { message };
  const serialized = JSON.stringify(payload);
  // eslint-disable-next-line no-console
  console[level](`[kernel] ${level.toUpperCase()}: ${serialized}`);
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
    log('info', `audit:${event}`, meta);
  },
};

export default logger;
