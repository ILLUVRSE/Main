// server/src/telemetry/logger.ts
// Tolerant telemetry shim for local dev: accepts either (message, meta) or (req, message)

export function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

function normalizeArgs(a: any, b?: any): { message: string; meta?: Record<string, any> } {
  if (typeof a === 'string') {
    return { message: a, meta: b };
  }
  // If first arg looks like an Express request, try to extract useful bits.
  try {
    if (a && a.method) {
      const req = a;
      const msg = typeof b === 'string' ? b : `${req.method} ${req.url}`;
      const meta = Object.assign({}, { method: req.method, url: req.url, headers: req.headers, body: req.body }, (typeof b === 'object' ? b : undefined));
      return { message: msg, meta };
    }
  } catch {}
  // fallback
  return { message: String(a), meta: b };
}

export function logInfo(a: any, b?: any): void {
  const { message, meta } = normalizeArgs(a,b);
  // eslint-disable-next-line no-console
  console.info(`[telemetry] INFO [${generateRequestId()}]`, message, meta ?? {});
}

export function logWarn(a: any, b?: any): void {
  const { message, meta } = normalizeArgs(a,b);
  // eslint-disable-next-line no-console
  console.warn(`[telemetry] WARN [${generateRequestId()}]`, message, meta ?? {});
}

export function logError(a: any, b?: any): void {
  const { message, meta } = normalizeArgs(a,b);
  // eslint-disable-next-line no-console
  console.error(`[telemetry] ERROR [${generateRequestId()}]`, message, meta ?? {});
}
