/**
 * patcher.ts
 *
 * Apply unified diffs or full-file content patches safely to the repository.
 * Supports modes:
 *   - "dry": validate and simulate changes (no writes)
 *   - "apply": write files, stage and commit changes, and return rollback metadata
 *   - "rollback": restore previousContents (used to undo an apply)
 *
 * The applyPatches API returns structured metadata that can be used to rollback.
 */

import fs from "fs/promises";
import path from "path";
import { applyPatch } from "diff";
import simpleGit from "simple-git";
import {
  REPO_PATH,
  GIT_USER_NAME,
  GIT_USER_EMAIL,
  GITHUB_REMOTE
} from "../config.js";

export type PatchInput = {
  path: string;
  content?: string; // full file content -> create/replace
  diff?: string; // unified diff string (patch)
};

export type AppliedEntry = {
  path: string;
  wasCreated: boolean;
  previousContent: string | null;
};

export type ApplyResult = {
  ok: boolean;
  mode: "dry" | "apply" | "rollback";
  applied?: AppliedEntry[];
  commitSha?: string | null;
  rollbackMetadata?: {
    previousContents: Record<string, string | null>;
  };
  errors?: string[];
};

/** Ensure a candidate repo-relative path is safe (no absolute, no traversal). */
function safeRepoPath(candidate: string): string {
  if (!candidate || typeof candidate !== "string") {
    throw new Error("Invalid path");
  }
  if (candidate.startsWith("/") || candidate.includes("\0")) {
    throw new Error("Absolute or invalid paths are not allowed");
  }
  // normalize and forbid traversal out of REPO_PATH
  const resolved = path.resolve(REPO_PATH, candidate);
  if (!resolved.startsWith(path.resolve(REPO_PATH) + path.sep) && resolved !== path.resolve(REPO_PATH)) {
    throw new Error("Path escapes repository root");
  }
  return resolved;
}

/** Read file contents, returning null if missing. */
async function readFileSafe(absPath: string): Promise<string | null> {
  try {
    const b = await fs.readFile(absPath, "utf8");
    return b;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

/** Write file, creating parent directories as needed. */
async function writeFileSafe(absPath: string, content: string) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, "utf8");
}

/** Delete file if exists. */
async function deleteFileSafe(absPath: string) {
  try {
    await fs.unlink(absPath);
  } catch (err: any) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
}

/**
 * Apply array of patches.
 * - patches: PatchInput[]
 * - mode: 'dry' | 'apply' | 'rollback'
 *
 * For 'rollback', each patch entry should be { path, content?: undefined, diff?: undefined, previousContent: string|null }
 * (we'll accept previousContent property on the PatchInput objects in that mode).
 */
export async function applyPatches(
  patches: Array<PatchInput & { previousContent?: string | null }>,
  mode: "dry" | "apply" | "rollback" = "apply"
): Promise<ApplyResult> {
  const git = simpleGit(REPO_PATH);
  const applied: AppliedEntry[] = [];
  const previousContents: Record<string, string | null> = {};
  const errors: string[] = [];

  if (!Array.isArray(patches) || patches.length === 0) {
    return { ok: true, mode, applied: [], commitSha: null };
  }

  // First pass: validate and compute new content without writing (for dry/apply)
  for (const p of patches) {
    try {
      // For rollback mode, we expect previousContent on each patch object
      if (mode === "rollback") {
        const repoAbs = safeRepoPath(p.path);
        const prev = p.previousContent ?? null;
        // restore it
        if (prev === null) {
          // delete file
          await deleteFileSafe(repoAbs);
        } else {
          await writeFileSafe(repoAbs, prev);
        }
        applied.push({ path: p.path, wasCreated: prev !== null, previousContent: null }); // previousContent not tracked for rollback
        continue;
      }

      // Validate path
      const repoAbs = safeRepoPath(p.path);
      const cur = await readFileSafe(repoAbs);
      previousContents[p.path] = cur;
      let newContent: string | null = null;

      if (typeof p.content === "string") {
        newContent = p.content;
      } else if (typeof p.diff === "string") {
        // apply unified diff to current content (or empty string)
        const base = cur ?? "";
        const patched = applyPatch(base, p.diff);
        if (patched === false || typeof patched !== "string") {
          throw new Error(`Failed to apply patch for ${p.path}`);
        }
        newContent = patched;
      } else {
        throw new Error(`Patch for ${p.path} missing 'content' or 'diff'`);
      }

      // If dry, don't write, just record what would happen
      if (mode === "dry") {
        applied.push({
          path: p.path,
          wasCreated: cur === null,
          previousContent: cur
        });
        continue;
      }

      // mode === 'apply': write the new content
      await writeFileSafe(repoAbs, newContent);
      applied.push({
        path: p.path,
        wasCreated: cur === null,
        previousContent: cur
      });
    } catch (err: any) {
      errors.push(`${p.path}: ${String(err?.message || err)}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, mode, applied, errors };
  }

  // If dry-run, return the simulated result (no git ops)
  if (mode === "dry") {
    return {
      ok: true,
      mode,
      applied,
      rollbackMetadata: { previousContents }
    };
  }

  // mode === 'apply': stage files and commit
  try {
    const filesToStage = applied.map((a) => a.path);
    if (filesToStage.length > 0) {
      await git.add(filesToStage);
      const author = `${GIT_USER_NAME} <${GIT_USER_EMAIL}>`;
      const message =
        filesToStage.length === 1
          ? `repowriter: apply ${filesToStage[0]}`
          : `repowriter: apply ${filesToStage.length} files`;
      // commit with author
      await git.commit(message, filesToStage, { "--author": author });
      // get last commit sha
      const sha = await git.revparse(["HEAD"]);
      return {
        ok: true,
        mode,
        applied,
        commitSha: sha,
        rollbackMetadata: { previousContents }
      };
    } else {
      // nothing staged (shouldn't happen if applied not empty)
      return { ok: true, mode, applied, commitSha: null, rollbackMetadata: { previousContents } };
    }
  } catch (err: any) {
    return { ok: false, mode, applied, errors: [String(err?.message || err)] };
  }
}

export default { applyPatches };

