import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execSync } from "child_process";

describe("patcher", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    // ensure config.ts will pick up these envs when imported
    process.env.OPENAI_API_KEY = "test-key";
    // create a sandbox repo for the test and set REPO_PATH so patcher uses it
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "repowriter-test-"));
    process.env.REPO_PATH = tmpDir;

    // init a git repo and set identity so commits succeed
    execSync("git init -q", { cwd: tmpDir });
    execSync('git config user.name "test-user"', { cwd: tmpDir });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
  });

  afterEach(async () => {
    // cleanup
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.OPENAI_API_KEY;
    delete process.env.REPO_PATH;
    vi.restoreAllMocks();
  });

  it("applies a replacement patch and creates a commit", async () => {
    // create initial file and commit it
    const filePath = path.join(tmpDir, "foo.txt");
    await fs.writeFile(filePath, "hello\n", "utf8");
    execSync('git add foo.txt && git commit -m "init foo" -q', { cwd: tmpDir });

    const { applyPatches } = await import("../src/services/patcher.js");
    const patches = [{ path: "foo.txt", content: "hello modified\n" }];

    const result = await applyPatches(patches, "apply");
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("apply");
    expect(Array.isArray(result.applied)).toBe(true);
    expect(result.applied && result.applied[0].path).toBe("foo.txt");
    expect(result.commitSha).toBeTruthy();

    // verify file content changed on disk
    const onDisk = await fs.readFile(filePath, "utf8");
    expect(onDisk).toBe("hello modified\n");

    // rollback metadata should include previousContents for foo.txt
    expect(result.rollbackMetadata).toBeTruthy();
    expect((result.rollbackMetadata as any).previousContents["foo.txt"]).toBe("hello\n");
  });

  it("simulates changes in dry mode and does not write files", async () => {
    const { applyPatches } = await import("../src/services/patcher.js");
    const patches = [{ path: "newfile.txt", content: "new content\n" }];

    const result = await applyPatches(patches, "dry");
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("dry");
    expect(result.applied && result.applied.length).toBe(1);

    // file must not exist on disk after dry-run
    const exists = await fs
      .access(path.join(tmpDir, "newfile.txt"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);

    // rollback metadata should include previousContents (null for new file)
    expect(result.rollbackMetadata).toBeTruthy();
    expect((result.rollbackMetadata as any).previousContents["newfile.txt"]).toBeNull();
  });
});

