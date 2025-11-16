// RepoWriter/server/src/services/rollback.ts
//
// Helpers to apply rollback metadata (previousContents) returned by the patcher after an apply.
//
// Behavior:
//  - previousContents: Array<{ path, content? }>
//    * If content is a string -> restore/write that content to the file path
//    * If content is null -> delete the file
//    * If content is undefined -> skip
//  - Protects against path traversal (ensures paths stay inside REPO_PATH).
//  - Makes in-memory backups of existing files and attempts to restore them if an error occurs.
//  - Commits the changes using gitCommit() and emits an audit event via logAuditEvent().
//  - Returns { ok: true, commit } on success.
//
// NOTE: This implementation assumes REPO_PATH is set and git.ts uses process.env.REPO_PATH
// (RepoWriter's git helpers read the env at import time). If you import this file in tests,
// set process.env.REPO_PATH before importing.

import fs from "fs/promises";
import path from "path";
import { gitCommit } from "./git";
import { logAuditEvent } from "./telemetry";

const REPO_ROOT = process.env.REPO_PATH || process.cwd();

/**
 * Ensure a repository-relative path does not escape the REPO_ROOT
 */
function ensureInsideRepo(relPath: string) {
  const abs = path.resolve(REPO_ROOT, relPath);
  const root = path.resolve(REPO_ROOT);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(`Path traversal detected or path outside repo: ${relPath}`);
  }
  return abs;
}

export type PreviousContent = {
  path: string;
  // when content is null -> delete the file
  content?: string | null;
};

/**
 * applyRollback
 *
 * Apply previousContents to the repository (REPO_PATH). Attempts to be safe:
 *  - takes backups of existing content and restores them if an error occurs
 *  - commits changes using gitCommit()
 *
 * @param previousContents array of { path, content? }
 * @param opts optional { message?: string }
 */
export async function applyRollback(
  previousContents: PreviousContent[],
  opts?: { message?: string }
): Promise<{ ok: true; commit: any }> {
  if (!Array.isArray(previousContents)) {
    throw new Error("previousContents must be an array");
  }

  const backups: { absPath: string; existed: boolean; content?: string }[] = [];

  try {
    for (const item of previousContents) {
      const rel = item.path;
      if (!rel || typeof rel !== "string") {
        throw new Error("invalid path in previousContents");
      }
      const abs = ensureInsideRepo(rel);

      // Record backup of existing file (if any)
      try {
        const cur = await fs.readFile(abs, "utf8");
        backups.push({ absPath: abs, existed: true, content: cur });
      } catch (err: any) {
        backups.push({ absPath: abs, existed: false });
      }

      if (item.content === null) {
        // Delete the file
        try {
          await fs.unlink(abs);
        } catch (err: any) {
          if (err.code !== "ENOENT") {
            throw err;
          }
          // else ignore nonexistent file
        }
      } else if (typeof item.content === "string") {
        // Ensure directory exists
        const dir = path.dirname(abs);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(abs, item.content, "utf8");
      } else {
        // content undefined -> skip
      }
    }

    // Commit changes
    const message = opts?.message || `repowriter: rollback ${new Date().toISOString()}`;
    const commitRes = await gitCommit(message);

    // Emit audit event (best-effort)
    try {
      logAuditEvent(
        `repowriter.rollback: committed rollback - message=${message} files=${previousContents
          .map((p) => p.path)
          .join(",")}`
      );
    } catch (e) {
      // swallow telemetry/ audit errors
      console.warn("logAuditEvent failed", e);
    }

    return { ok: true, commit: commitRes };
  } catch (err) {
    // Attempt to restore backups to avoid leaving repo in inconsistent state
    try {
      for (const b of backups) {
        if (b.existed) {
          await fs.mkdir(path.dirname(b.absPath), { recursive: true });
          await fs.writeFile(b.absPath, b.content || "", "utf8");
        } else {
          // ensure removal if it was created
          try {
            await fs.unlink(b.absPath);
          } catch {
            // ignore
          }
        }
      }
    } catch (restoreErr) {
      console.error("Failed to restore backups after rollback error:", restoreErr);
    }
    throw err;
  }
}

export default { applyRollback };

