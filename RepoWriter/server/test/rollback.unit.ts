// RepoWriter/server/test/rollback.unit.ts
// Vitest unit tests for applyRollback in rollback.ts
//
// Tests:
//  - successful applyRollback: writes, commits (mocked), emits audit, files updated
//  - failure during commit: applyRollback throws and original files are restored

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Mock gitCommit and telemetry before importing the module under test.
// This ensures rollback.ts receives the mocked implementations.
vi.mock("../../src/services/git", () => {
  return {
    gitCommit: vi.fn(),
  };
});

vi.mock("../../src/services/telemetry", () => {
  return {
    logAuditEvent: vi.fn(),
  };
});

import { applyRollback } from "../../src/services/rollback";
import { gitCommit } from "../../src/services/git";
import { logAuditEvent } from "../../src/services/telemetry";

describe("applyRollback", () => {
  let tmp: string;

  beforeEach(async () => {
    // create a fresh temp repo dir and set REPO_PATH before tests
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repowriter-test-"));
    process.env.REPO_PATH = tmp;
    // ensure the directory exists (should by mkdtemp)
    await fs.mkdir(tmp, { recursive: true });
    // reset mocks
    (gitCommit as any).mockReset();
    (logAuditEvent as any).mockReset();
  });

  afterEach(async () => {
    // cleanup
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("applies rollback, commits and emits audit event", async () => {
    // Prepare repo files
    const dir = path.join(tmp, "dir");
    await fs.mkdir(dir, { recursive: true });
    const existing = path.join(dir, "existing.txt");
    await fs.writeFile(existing, "before", "utf8");
    const toDelete = path.join(tmp, "to_delete.txt");
    await fs.writeFile(toDelete, "delete-me", "utf8");

    // Mock gitCommit to succeed
    (gitCommit as any).mockResolvedValue({ commit: "ok" });

    const previousContents = [
      { path: "dir/existing.txt", content: "after" }, // replace
      { path: "new.txt", content: "new-file-content" }, // create
      { path: "to_delete.txt", content: null }, // delete
    ];

    const res = await applyRollback(previousContents, { message: "test rollback" });
    expect(res).toHaveProperty("ok", true);
    expect(res).toHaveProperty("commit");

    // Verify file contents
    const existingContent = await fs.readFile(existing, "utf8");
    expect(existingContent).toBe("after");

    const newContent = await fs.readFile(path.join(tmp, "new.txt"), "utf8");
    expect(newContent).toBe("new-file-content");

    // to_delete.txt should no longer exist
    let exists = true;
    try {
      await fs.access(toDelete);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);

    // gitCommit should be called once
    expect((gitCommit as any).mock.calls.length).toBeGreaterThan(0);

    // audit event emitted
    expect((logAuditEvent as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    const msg = (logAuditEvent as any).mock.calls[0][0] as string;
    expect(msg).toContain("repowriter.rollback");
  });

  it("restores backups when commit fails", async () => {
    // Prepare repo files
    const dir = path.join(tmp, "dir2");
    await fs.mkdir(dir, { recursive: true });
    const existing = path.join(dir, "existing2.txt");
    await fs.writeFile(existing, "original", "utf8");
    const toDelete = path.join(tmp, "del2.txt");
    await fs.writeFile(toDelete, "todelete", "utf8");

    // Make gitCommit throw to simulate failure during commit
    (gitCommit as any).mockRejectedValue(new Error("git failure"));

    const previousContents = [
      { path: "dir2/existing2.txt", content: "new-value" },
      { path: "del2.txt", content: null }, // delete
    ];

    // Expect applyRollback to throw due to gitCommit rejection
    await expect(applyRollback(previousContents, { message: "trigger failure" })).rejects.toThrow(
      /git failure/
    );

    // Verify original files were restored
    const existingContent = await fs.readFile(existing, "utf8");
    expect(existingContent).toBe("original");

    // toDelete should still exist with original content
    const delContent = await fs.readFile(toDelete, "utf8");
    expect(delContent).toBe("todelete");
  });
});

