/**
 * marketplace/ui/src/lib/hooks/usePoll.ts
 *
 * Generic polling hook.
 *
 * Usage:
 *  const { data, start, stop, running } = usePoll(async () => {
 *     // do a request and return result
 *  }, { intervalMs: 1500, immediate: true });
 *
 * - The hook does not automatically retry on error beyond the next tick.
 * - start() will start polling; stop() cancels it.
 * - If `immediate` is true it invokes the function immediately on start.
 *
 * Note: keep the polled function stable (useCallback) to avoid restarting
 * unnecessarily.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type UsePollOpts<T> = {
  intervalMs?: number;
  immediate?: boolean;
  onError?: (err: any) => void;
  // optional transformer of the polled value before setData
  transform?: (val: T) => T;
};

export function usePoll<T = any>(
  fn: () => Promise<T>,
  opts: UsePollOpts<T> = {}
) {
  const { intervalMs = 2000, immediate = true, onError, transform } = opts;
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const fnRef = useRef(fn);

  // keep fnRef up-to-date without re-creating polling loop
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [data, setData] = useState<T | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [lastError, setLastError] = useState<any>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      try {
        window.clearTimeout(timerRef.current);
      } catch {
        // ignore (SSR)
      }
      timerRef.current = null;
    }
  };

  const pollOnce = useCallback(async () => {
    try {
      const val = await fnRef.current();
      if (!mountedRef.current) return;
      setData(transform ? transform(val) : val);
      setLastError(null);
    } catch (err) {
      setLastError(err);
      if (onError) {
        try {
          onError(err);
        } catch {
          // ignore
        }
      }
    }
  }, [onError, transform]);

  const tick = useCallback(async () => {
    if (!runningRef.current) return;
    await pollOnce();
    if (!mountedRef.current || !runningRef.current) return;
    // schedule next tick
    timerRef.current = window.setTimeout(tick, intervalMs);
  }, [intervalMs, pollOnce]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    if (immediate) {
      // run immediately then schedule next
      tick().catch(() => {
        /* ignore */
      });
    } else {
      timerRef.current = window.setTimeout(tick, intervalMs);
    }
  }, [immediate, intervalMs, tick]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    clearTimer();
  }, []);

  // convenience: restart
  const restart = useCallback(() => {
    stop();
    start();
  }, [start, stop]);

  return {
    data,
    running,
    lastError,
    start,
    stop,
    restart,
    pollOnce, // manual single invocation
  };
}

export default usePoll;

