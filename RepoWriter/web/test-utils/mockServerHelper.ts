/**
 * mockServerHelper.ts
 *
 * Lightweight helper used by UI/e2e tests to start/stop the OpenAI mock
 * and the local RepoWriter server programmatically.
 *
 * Note: This is a convenience for local development and tests. It uses
 * child_process.spawn to start the processes detached so they keep running
 * independently; callers should keep references returned and call stop*
 * when finished.
 *
 * Methods:
 *  - startOpenAIMock(): Promise<ChildProcess | null>
 *  - stopProcess(child: ChildProcess | null): Promise<void>
 *  - startServer(): Promise<ChildProcess>
 *  - waitForUrl(url, timeoutMs): Promise<void>
 *
 * Uses global fetch (Node 18+). If your environment doesn't have fetch,
 * replace with node-fetch.
 */

import { spawn, ChildProcess } from "child_process";

export const OPENAI_MOCK_PORT = 9876;
export const OPENAI_MOCK_URL = `http://127.0.0.1:${OPENAI_MOCK_PORT}`;
export const SERVER_HEALTH = "http://localhost:7071/api/health";

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/** Simple polling wait for a url to return ok (200-ish). */
export async function waitForUrl(url: string, timeoutMs = 20_000, intervalMs = 250): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { cache: "no-store" } as any);
      if (res && res.ok) return;
    } catch {
      // ignore
    }
    await delay(intervalMs);
  }
  throw new Error(`Timeout waiting for ${url} (${timeoutMs}ms)`);
}

/**
 * Start the node-based OpenAI mock if not already running.
 * Returns the ChildProcess if the helper started it, or null if a mock is already running.
 */
export async function startOpenAIMock(): Promise<ChildProcess | null> {
  // quick health check
  try {
    const r = await fetch(`${OPENAI_MOCK_URL}/health`).catch(() => null);
    if (r && r.ok) {
      return null;
    }
  } catch {
    // ignore
  }

  // spawn the JS mock
  const child = spawn("node", ["RepoWriter/test/openaiMock.js"], {
    detached: true,
    stdio: "ignore",
  });

  // detach so the child continues if the parent exits; unref to avoid waiting
  try {
    child.unref();
  } catch {
    // ignore
  }

  // wait for mock health
  await waitForUrl(`${OPENAI_MOCK_URL}/health`, 10_000, 200);
  return child;
}

/**
 * Stop a spawned child process (best-effort). Accepts the ChildProcess returned by startOpenAIMock/startServer.
 */
export async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child) return;
  try {
    if (child.pid) {
      process.kill(-child.pid, "SIGTERM"); // try killing process group
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

/**
 * Start the RepoWriter server dev process via npm script.
 * Returns the spawned ChildProcess (detached).
 */
export async function startServer(): Promise<ChildProcess> {
  // Start server (npm --prefix RepoWriter/server run dev)
  // Note: server writes logs to RepoWriter/server/server.log when started in our local scripts;
  // here we simply spawn the npm dev script detached for tests.
  const child = spawn("npm", ["--prefix", "RepoWriter/server", "run", "dev"], {
    detached: true,
    stdio: "ignore",
  });
  try {
    child.unref();
  } catch {}
  // wait for server health
  await waitForUrl(SERVER_HEALTH, 20_000, 300);
  return child;
}

