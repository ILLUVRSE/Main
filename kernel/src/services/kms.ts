/**
 * kernel/src/services/kms.ts
 *
 * Lightweight helpers for interacting with the configured KMS endpoint.
 * The Kernel only needs the ability to probe reachability for health/readiness
 * checks, so the helper intentionally stays small and dependency-free.
 */

import http from 'http';
import https from 'https';

/**
 * probeKmsReachable performs a simple HTTP GET against the provided endpoint
 * and resolves to `true` if the TCP connection succeeds and a response is
 * received before the timeout. Any network or protocol error results in
 * `false` so callers can surface KMS reachability in health checks.
 */
export async function probeKmsReachable(endpoint?: string, timeoutMs = 3000): Promise<boolean> {
  const url = (endpoint || '').trim();
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    return await new Promise<boolean>((resolve) => {
      const opts: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
        path: (parsed.pathname || '/') + (parsed.search || ''),
        method: 'GET',
        timeout: timeoutMs,
      };

      const req = lib.request(opts, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        try {
          req.destroy();
        } catch {
          // ignore
        }
        resolve(false);
      });

      req.end();
    });
  } catch {
    return false;
  }
}

export default probeKmsReachable;

