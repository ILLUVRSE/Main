// sentinelnet/src/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function now() {
  return new Date().toISOString();
}

function format(level: LogLevel, msg: string, meta?: any) {
  const base = `[${now()}] [sentinelnet] [${level.toUpperCase()}] ${msg}`;
  if (!meta) return base;
  try {
    return `${base} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
  } catch (e) {
    return `${base} <unserializable-meta>`;
  }
}

const logger = {
  debug(msg: string, meta?: any) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug(format('debug', msg, meta));
    }
  },
  info(msg: string, meta?: any) {
    // eslint-disable-next-line no-console
    console.info(format('info', msg, meta));
  },
  warn(msg: string, meta?: any) {
    // eslint-disable-next-line no-console
    console.warn(format('warn', msg, meta));
  },
  error(msg: string | Error, meta?: any) {
    if (msg instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(format('error', msg.message, { stack: msg.stack, ...meta }));
    } else {
      // eslint-disable-next-line no-console
      console.error(format('error', msg, meta));
    }
  },
};

export default logger;

