/**
 * Minimal structured logger used across the marketplace server.
 *
 * This intentionally avoids external dependencies so it's easy to run in CI,
 * local dev, or serverless environments. It serializes logs as JSON to stdout/stderr
 * so they can be parsed by log aggregators.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type Meta = Record<string, any> | Error | undefined;

interface Logger {
  debug: (msg: string, meta?: Meta) => void;
  info: (msg: string, meta?: Meta) => void;
  warn: (msg: string, meta?: Meta) => void;
  error: (msg: string, meta?: Meta) => void;
  child: (fields: Record<string, any>) => Logger;
}

/**
 * Serialize an Error into a plain object suitable for JSON logging.
 */
function serializeError(err: any) {
  if (!err) return undefined;
  if (typeof err === 'string') return { message: err };
  if (err instanceof Error) {
    const anyErr: any = err;
    return {
      message: anyErr.message,
      name: anyErr.name,
      stack: anyErr.stack,
      ...Object.keys(anyErr).reduce((acc: any, k) => {
        if (k !== 'message' && k !== 'name' && k !== 'stack') acc[k] = anyErr[k];
        return acc;
      }, {}),
    };
  }
  // Fallback: attempt shallow copy
  try {
    return typeof err === 'object' ? JSON.parse(JSON.stringify(err)) : { value: String(err) };
  } catch {
    return { value: String(err) };
  }
}

/**
 * Normalize meta into an object and avoid circular references when possible.
 */
function normalizeMeta(meta?: Meta) {
  if (!meta) return undefined;
  if (meta instanceof Error) return { err: serializeError(meta) };
  if (typeof meta === 'object') {
    // shallow copy and serialize nested Error objects
    const out: any = {};
    for (const k of Object.keys(meta)) {
      const v = (meta as any)[k];
      if (v instanceof Error) out[k] = serializeError(v);
      else out[k] = v;
    }
    return out;
  }
  return { meta: meta };
}

/**
 * Emit a structured JSON log. Debug/info -> stdout, warn/error -> stderr.
 */
function emit(level: LogLevel, msg: string, meta?: Meta, extra?: Record<string, any>) {
  try {
    const ts = new Date().toISOString();
    const normalized = normalizeMeta(meta);
    const entry: any = {
      level,
      ts,
      msg,
      ...extra,
    };
    if (normalized) entry.meta = normalized;

    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  } catch (err) {
    // As a last resort, fallback to console log to avoid crashing the app on logging errors.
    // eslint-disable-next-line no-console
    console.log(`[${level}] ${msg}`, meta, extra);
  }
}

/**
 * Create a logger instance optionally pre-populated with `fields` which are
 * merged into every log entry. `child()` returns a new logger with additional fields.
 */
function createLogger(fields: Record<string, any> = {}): Logger {
  return {
    debug: (msg: string, meta?: Meta) => emit('debug', msg, meta, { ...fields }),
    info: (msg: string, meta?: Meta) => emit('info', msg, meta, { ...fields }),
    warn: (msg: string, meta?: Meta) => emit('warn', msg, meta, { ...fields }),
    error: (msg: string, meta?: Meta) => emit('error', msg, meta, { ...fields }),
    child: (more: Record<string, any>) => createLogger({ ...fields, ...more }),
  };
}

// Default logger - can be imported and used directly.
// Example: import logger from '../lib/logger'; logger.info('started', { port: 3000 });
const logger = createLogger();

export default logger;

