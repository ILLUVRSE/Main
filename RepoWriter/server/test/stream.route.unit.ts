/**
 * stream.route.unit.ts
 *
 * Unit tests for POST /api/openai/stream route.
 * - Mocks streamChat to yield deterministic chunks
 * - Starts the real Express app on an ephemeral port and issues an HTTP request
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";

describe("openai /stream route", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.resetModules();
    // required by config.ts so imports succeed
    process.env.OPENAI_API_KEY = "test-key";

    // Mock streamChat to yield two payloads and then end
    const streamMock = async function* () {
      // Yield two simple JSON payload strings
      yield { raw: '{"fragment":"one"}' };
      yield { raw: '{"fragment":"two"}' };
      // then return (generator will finish)
    };
    vi.mock("../src/services/openaiStreamClient.js", () => ({
      streamChat: streamMock
    }));

    // Import app after mocks are in place and start HTTP server
    const { default: app } = await import("../src/app.js");
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    // @ts-ignore
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.OPENAI_API_KEY;
    vi.restoreAllMocks();
  });

  it("streams SSE data events and ends with [DONE]", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/openai/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Make a plan", memory: [] }),
    });

    expect(res.ok).toBeTruthy();

    // Collect full streamed text
    const text = await res.text();

    // Server should wrap each raw payload in an SSE "data: ..." line and then emit "[DONE]"
    expect(text).toContain('data: {"fragment":"one"}');
    expect(text).toContain('data: {"fragment":"two"}');
    expect(text).toContain("data: [DONE]");
  });
});

