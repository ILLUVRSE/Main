// memory-layer/service/observability/tracing.ts
/**
 * OpenTelemetry tracing helpers for Memory Layer
 *
 * - initTracing(serviceName)  -> initializes NodeSDK and auto-instrumentations
 * - shutdownTracing()         -> gracefully stops SDK
 * - expressMiddleware        -> Express middleware that adds trace headers and basic attributes
 * - startSpan(...)           -> start a child span programmatically
 * - attachMemoryNodeToSpan   -> set memory.node_id attribute on current span
 * - injectTraceIntoAuditPayload -> returns a payload augmented with trace metadata
 *
 * Behavior:
 *  - Disabled if MEMORY_TRACING_ENABLED=false (safe no-op).
 *  - Uses NodeSDK + getNodeAutoInstrumentations to auto-instrument http/express/db libs.
 *
 * Usage:
 *  import { initTracing, expressMiddleware, attachMemoryNodeToSpan, injectTraceIntoAuditPayload } from './observability/tracing';
 *  await initTracing(process.env.SERVICE_NAME || 'memory-layer');
 *  app.use(expressMiddleware);
 *  // In memoryService when creating audit payload:
 *  const payload = { owner, metadata, caller };
 *  const enriched = injectTraceIntoAuditPayload(payload);
 *  insertAuditEvent(..., payload: enriched, ...);
 */

import type { Request, Response, NextFunction } from 'express';
import { context, propagation, trace, Span, SpanOptions, SpanKind } from '@opentelemetry/api';

const TRACING_ENABLED = String(process.env.MEMORY_TRACING_ENABLED ?? 'true').toLowerCase() !== 'false';

let sdk: any = null;
let tracer = trace.getTracer('memory-layer', '1.0.0');

/**
 * Initialize OpenTelemetry Node SDK with sensible defaults and auto-instrumentations.
 * If OTEL exporters are configured via environment variables, NodeSDK will use them.
 *
 * NOTE: this function is async because NodeSDK.start() returns a Promise.
 */
export async function initTracing(serviceName = process.env.SERVICE_NAME ?? 'memory-layer') {
  if (!TRACING_ENABLED) {
    console.info('[tracing] tracing disabled via MEMORY_TRACING_ENABLED=false');
    return;
  }

  // If already initialized, no-op
  if (sdk) {
    console.warn('[tracing] initTracing called but SDK already initialized');
    return;
  }

  try {
    // Lazy import so module can be loaded even when packages not installed (tests/CI)
    // but throw a helpful error if tracing is enabled and packages missing.
    // Using dynamic imports keeps TS happy when building on environments without OTEL deps.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName
    });

    sdk = new NodeSDK({
      resource,
      instrumentations: [getNodeAutoInstrumentations()],
      // NodeSDK will configure exporters by environment (OTEL_EXPORTER_*)
    });

    await sdk.start();
    // Replace tracer with one from the global tracer provider (now that SDK started)
    tracer = trace.getTracer('memory-layer');

    console.info(`[tracing] OpenTelemetry NodeSDK started for service="${serviceName}"`);
  } catch (err) {
    console.error('[tracing] failed to initialize OpenTelemetry SDK:', (err as Error).message || err);
    // Do not throw — fall back to no-op tracing
    sdk = null;
  }
}

/**
 * Shutdown tracing SDK gracefully.
 */
export async function shutdownTracing() {
  if (!TRACING_ENABLED) return;
  if (!sdk) {
    console.warn('[tracing] shutdownTracing called but SDK not initialized');
    return;
  }
  try {
    await sdk.shutdown();
    console.info('[tracing] OpenTelemetry SDK shutdown complete');
  } catch (err) {
    console.error('[tracing] error during SDK shutdown:', (err as Error).message || err);
  } finally {
    sdk = null;
  }
}

/**
 * Express middleware to attach trace attributes and response header.
 * Auto-instrumentation will create spans for incoming HTTP requests; this middleware
 * enriches the span and copies trace id to response headers for easier debugging.
 */
export function expressMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!TRACING_ENABLED) {
    return next();
  }

  try {
    // Get current span that auto-instrumentation created for the HTTP request
    const currentSpan = trace.getSpan(context.active());
    if (currentSpan) {
      // Add common attributes
      currentSpan.setAttribute('http.method', req.method);
      currentSpan.setAttribute('http.route', req.path);
      currentSpan.setAttribute('http.url', req.originalUrl || req.url);
      currentSpan.setAttribute('http.client_ip', String(req.ip ?? ''));

      // Set trace headers on response for visibility (X-Trace-Id)
      const sc = currentSpan.spanContext?.();
      if (sc && sc.traceId) {
        res.setHeader('X-Trace-Id', sc.traceId);
        res.setHeader('X-Span-Id', sc.spanId);
      }
    }
  } catch (err) {
    // Do not let tracing errors crash requests
    // eslint-disable-next-line no-console
    console.error('[tracing] expressMiddleware error:', (err as Error).message || err);
  } finally {
    next();
  }
}

/**
 * Start a named span as a child of the current context (useful for internal operations).
 * Returns the started Span. Caller must call span.end() when done.
 *
 * Example:
 * const span = startSpan('vector.upsert', { attributes: { provider: 'pinecone' } });
 * try { ... } finally { span.end(); }
 */
export function startSpan(name: string, options?: { kind?: SpanKind; attributes?: Record<string, unknown> }) : Span {
  if (!TRACING_ENABLED) {
    // Return a no-op Span-like object (very small shim) to avoid checks everywhere.
    // We'll create a minimal shim implementing .end() and .setAttribute()
    const noopSpan: Partial<Span> = {
      end: () => undefined,
      setAttribute: () => noopSpan as unknown as Span,
      addEvent: () => noopSpan as unknown as Span,
      setStatus: () => noopSpan as unknown as Span,
      spanContext: () => ({ traceId: '0', spanId: '0', traceFlags: 0 })
    };
    return noopSpan as Span;
  }

  try {
    const spanOptions: SpanOptions = {
      kind: options?.kind ?? SpanKind.INTERNAL
    };
    const span = tracer.startSpan(name, spanOptions);
    if (options?.attributes) {
      for (const [k, v] of Object.entries(options.attributes)) {
        span.setAttribute(k, v as any);
      }
    }
    // Run span within context so nested operations see it as parent.
    return span;
  } catch (err) {
    console.error('[tracing] startSpan error:', (err as Error).message || err);
    // return noop span on error
    const noopSpan: Partial<Span> = {
      end: () => undefined,
      setAttribute: () => noopSpan as unknown as Span,
      addEvent: () => noopSpan as unknown as Span,
      setStatus: () => noopSpan as unknown as Span,
      spanContext: () => ({ traceId: '0', spanId: '0', traceFlags: 0 })
    };
    return noopSpan as Span;
  }
}

/**
 * Attach a memoryNodeId attribute to the current active span (if available).
 * Useful to ensure audit events have a direct linking attribute in traces.
 */
export function attachMemoryNodeToSpan(memoryNodeId: string) {
  if (!TRACING_ENABLED) return;
  try {
    const span = trace.getSpan(context.active());
    if (span) {
      span.setAttribute('memory.node_id', memoryNodeId);
    }
  } catch (err) {
    console.error('[tracing] attachMemoryNodeToSpan error:', (err as Error).message || err);
  }
}

/**
 * Returns the current trace info (traceId, spanId, sampled flag) if available.
 */
export function getCurrentTraceInfo(): { traceId: string; spanId: string; sampled: boolean } | null {
  if (!TRACING_ENABLED) return null;
  try {
    const span = trace.getSpan(context.active());
    if (!span) return null;
    const sc = span.spanContext();
    if (!sc || !sc.traceId) return null;
    return {
      traceId: sc.traceId,
      spanId: sc.spanId,
      sampled: Boolean(sc.traceFlags & 0x01)
    };
  } catch (err) {
    console.error('[tracing] getCurrentTraceInfo error:', (err as Error).message || err);
    return null;
  }
}

/**
 * Inject current trace context into an audit payload object. Returns a shallow-cloned payload
 * with a `trace` object appended:
 *
 * {
 *   ...payload,
 *   _trace: {
 *     traceId, spanId, sampled, traceFlags
 *   }
 * }
 *
 * This enables audit events to contain trace provenance without requiring the consumer to
 * read the HTTP headers.
 */
export function injectTraceIntoAuditPayload<T extends Record<string, unknown>>(payload: T): T & { _trace?: { traceId: string; spanId: string; sampled: boolean; traceFlags?: number } } {
  try {
    const info = getCurrentTraceInfo();
    if (!info) {
      // still return original payload (cloned) to avoid mutation
      return { ...(payload as any) };
    }
    const cloned = { ...(payload as any) };
    cloned._trace = { traceId: info.traceId, spanId: info.spanId, sampled: info.sampled };
    return cloned;
  } catch (err) {
    console.error('[tracing] injectTraceIntoAuditPayload error:', (err as Error).message || err);
    return { ...(payload as any) };
  }
}

/**
 * Helper to run a function inside a new span and end the span when done (automatically).
 * Returns result of fn (can be async).
 */
export async function withSpan<T>(name: string, fn: (s: Span) => Promise<T> | T, opts?: { attributes?: Record<string, unknown>; kind?: SpanKind }) : Promise<T> {
  if (!TRACING_ENABLED) {
    // no tracing -- just run the function
    return fn(null as unknown as Span) as Promise<T>;
  }
  const span = startSpan(name, { attributes: opts?.attributes, kind: opts?.kind });
  const ctx = trace.setSpan(context.active(), span);
  try {
    // Use context.with to ensure nested async ops use this span as parent
    return await context.with(ctx, async () => {
      const result = await fn(span);
      return result;
    });
  } catch (err) {
    try {
      span.setStatus({ code: 2, message: (err as Error).message ?? String(err) }); // 2 = ERROR
      span.recordException(err as Error);
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      span.end();
    } catch {
      // ignore
    }
  }
}

/**
 * Inject current trace context into an outgoing HTTP headers carrier (for manual calls).
 * Example usage before calling a signing proxy or external provider:
 *   const headers: Record<string,string> = {};
 *   injectTraceToCarrier(headers);
 */
export function injectTraceToCarrier(carrier: Record<string, unknown>) {
  if (!TRACING_ENABLED) return carrier;
  try {
    const span = trace.getSpan(context.active());
    if (!span) return carrier;
    propagation.inject(context.active(), carrier);
    return carrier;
  } catch (err) {
    console.error('[tracing] injectTraceToCarrier error:', (err as Error).message || err);
    return carrier;
  }
}

// Export default for convenience
export default {
  initTracing,
  shutdownTracing,
  expressMiddleware,
  startSpan,
  withSpan,
  attachMemoryNodeToSpan,
  injectTraceIntoAuditPayload,
  injectTraceToCarrier,
  getCurrentTraceInfo
};

