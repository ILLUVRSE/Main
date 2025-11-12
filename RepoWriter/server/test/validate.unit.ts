import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("validator.validatePatches", () => {
  let runTestsMock: any;

  beforeEach(async () => {
    vi.resetModules();
    // Provide a mock for sandboxRunner.runTestsInSandbox before importing validator
    runTestsMock = vi.fn();
    vi.mock("../src/services/sandboxRunner.js", () => {
      return {
        runTestsInSandbox: runTestsMock
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns success when sandbox runner returns ok", async () => {
    // Arrange: sandbox runner returns success
    runTestsMock.mockResolvedValue({
      ok: true,
      stdout: "All tests passed",
      stderr: "",
      timedOut: false,
      exitCode: 0,
      sandboxPath: "/tmp/sandbox"
    });

    const { validatePatches } = await import("../src/services/validator.js");

    // Act
    const res = await validatePatches([{ path: "foo.txt", content: "hello\n" }], {
      testCommand: ["echo", "ok"],
      timeoutMs: 2000
    });

    // Assert
    expect(res).toBeTruthy();
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("All tests passed");
    expect(res.exitCode).toBe(0);
  });

  it("returns failure when sandbox runner reports failing exit code", async () => {
    runTestsMock.mockResolvedValue({
      ok: false,
      stdout: "",
      stderr: "Test failures",
      timedOut: false,
      exitCode: 1
    });

    const { validatePatches } = await import("../src/services/validator.js");

    const res = await validatePatches([{ path: "bar.txt", content: "broken\n" }], {
      testCommand: ["npm", "test"]
    });

    expect(res).toBeTruthy();
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("Test failures");
    expect(res.exitCode).toBe(1);
  });

  it("handles runner throwing an error and returns an error result", async () => {
    runTestsMock.mockRejectedValue(new Error("unexpected failure"));

    const { validatePatches } = await import("../src/services/validator.js");

    const res = await validatePatches([{ path: "x.txt", content: "x\n" }], {});

    expect(res).toBeTruthy();
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    expect(String(res.error)).toContain("unexpected failure");
  });
});

