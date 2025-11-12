import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * Note: We set process.env.REPO_PATH before importing sandboxRunner so that
 * server/src/config.ts picks up the test repo path when evaluated.
 */

describe("sandboxRunner", () => {
  it("applies patches and runs tests successfully", async () => {
    // Create a temporary directory to act as REPO_PATH
    const tmpPrefix = path.join(os.tmpdir(), "repowriter-test-");
    const repoDir = await fs.mkdtemp(tmpPrefix);

    try {
      // Minimal package.json with a deterministic test script that exits 0.
      const pkg = {
        name: "repowriter-test-repo",
        version: "0.0.0",
        scripts: {
          test: "node -e \"console.log('TEST_OK')\""
        }
      };
      await fs.writeFile(path.join(repoDir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");

      // Create an initial file in the repo
      await fs.writeFile(path.join(repoDir, "initial.txt"), "initial\n", "utf8");

      // Ensure env var is set before importing sandboxRunner so config.ts picks it up
      process.env.REPO_PATH = repoDir;

      // Dynamic import after env var set
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sandboxMod = await import("../src/services/sandboxRunner.js");
      const runSandboxForPatches = sandboxMod.runSandboxForPatches ?? sandboxMod.default?.runSandboxForPatches ?? sandboxMod.default?.runSandboxForPatches;

      if (!runSandboxForPatches) {
        // In case the module default-exported, try default
        const mod = sandboxMod.default || sandboxMod;
        if (typeof mod.runSandboxForPatches === "function") {
          // ok
        } else {
          throw new Error("Could not load runSandboxForPatches from sandboxRunner module");
        }
      }

      // Define a patch to create hello.txt
      const patches = [
        { path: "hello.txt", content: "Hello from sandbox\n" }
      ];

      // Call sandbox runner with a small timeout and keepTemp for debugging in CI if needed
      const res = await runSandboxForPatches(patches, {
        timeoutMs: 30_000,
        testCommand: "npm test",
        keepTemp: false
      });

      // Expect tests ran and passed
      expect(res).toBeTruthy();
      expect(res.ok).toBe(true);
      expect(res.tests).toBeTruthy();
      expect(res.tests?.ok).toBe(true);
      // typecheck/lint may be undefined (no tsconfig / lint), but tests must be present.
    } finally {
      // Cleanup the repoDir
      try {
        await fs.rm(repoDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });
});

