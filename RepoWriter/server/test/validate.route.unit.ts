/**
 * validate.route.unit.ts
 *
 * Unit tests for POST /api/openai/validate route.
 * - Mocks validator.validatePatches so tests are fast/deterministic
 * - Starts the real Express app on an ephemeral port and issues HTTP requests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";

describe("openai /validate route", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    // Ensure a fresh module cache so our mocks are used by app import
    vi.resetModules();

    // Required by config.ts so imports succeed
    process.env.OPENAI_API_KEY = "test-key";

    // Mock the validator service to return a deterministic success result
    const validateMock = vi.fn(async () => {
      return {
        ok: true,
        stdout: "All tests passed",
        stderr: "",
        timedOut: false,
        exitCode: 0
      };
    });
    vi.mock("../src/services/validator.js", () => ({
      validatePatches: validateMock
    }));

    // Import app after mocks are in place and start HTTP server
    const { default: app } = await import("../src/app.js");
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    // @ts-ignore - address() can be string | AddressInfo; tests use ephemeral numeric port
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.OPENAI_API_KEY;
    vi.restoreAllMocks();
  });

  it("returns 400 when patches missing or invalid", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/openai/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.ok === false || j.error).toBeTruthy();
  });

  it("returns validator output for valid patches", async () => {
    const payload = {
      patches: [{ path: "foo.txt", content: "hello\n" }],
      testCommand: ["echo", "ok"]
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/openai/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(res.ok).toBeTruthy();
    const j = await res.json();
    expect(j).toBeTruthy();
    expect(j.ok).toBe(true);
    expect(typeof j.stdout === "string" && j.stdout.length > 0).toBeTruthy();
    expect((j.stdout || "").toString()).toContain("All tests passed");
  });
});

