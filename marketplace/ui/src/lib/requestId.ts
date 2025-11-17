/**
 * marketplace/ui/src/lib/requestId.ts
 *
 * Small helper to generate deterministic-ish request ids for telemetry,
 * retry/idempotency correlation and logging.
 *
 * Usage:
 *   import { newRequestId } from '@/lib/requestId';
 *   const id = newRequestId(); // 'r_01f4a2e9...'
 *
 * The implementation prefers crypto.randomUUID() when available, and falls
 * back to a compact pseudo-uuid using Math.random.
 */

export function newRequestId(): string {
  try {
    // @ts-ignore - available in modern browsers & Node 18+
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return `r_${(crypto as any).randomUUID().replace(/-/g, '')}`;
    }
    // In worker environments, try globalThis.crypto
    // @ts-ignore
    if (typeof globalThis !== 'undefined' && (globalThis as any).crypto && typeof (globalThis as any).crypto.randomUUID === 'function') {
      // @ts-ignore
      return `r_${(globalThis as any).crypto.randomUUID().replace(/-/g, '')}`;
    }
  } catch {
    // ignore and fallback
  }

  // fallback: pseudo-random id
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `r_${s4()}${s4()}${s4()}${s4()}`;
}

