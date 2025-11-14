/**
 * patcher.ts
 *
 * Apply unified diffs or full-file content patches safely to the repository.
 * Added: applyPatchesAndPush helper that applies patches, commits, and optionally
 * creates a branch/pushes and opens a PR via the `github` helpers.
 *
 * Existing behavior preserved.
 */
import fs from "fs/promises";
import path from "path";
import { applyPatch } from "diff";
import simpleGit from "simple-git";
import { REPO_PATH, GIT_USER_NAME, GIT_USER_EMAIL } from "../config.js";
// Use lowercase github.js to match actual filename on disk
import { createBranchCommitPushPR } from "./github.js";
/** Ensure a candidate repo-relative path is safe (no absolute, no traversal). */
function safeRepoPath(candidate) {
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
async function readFileSafe(absPath) {
    try {
        const b = await fs.readFile(absPath, "utf8");
        return b;
    }
    catch (err) {
        if (err?.code === "ENOENT")
            return null;
        throw err;
    }
}
/** Write file, creating parent directories as needed. */
async function writeFileSafe(absPath, content) {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, "utf8");
}
/** Delete file if exists. */
async function deleteFileSafe(absPath) {
    try {
        await fs.unlink(absPath);
    }
    catch (err) {
        if (err?.code === "ENOENT")
            return;
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
export async function applyPatches(patches, mode = "apply") {
    const git = simpleGit(REPO_PATH);
    const applied = [];
    const previousContents = {};
    const errors = [];
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
                }
                else {
                    await writeFileSafe(repoAbs, prev);
                }
                applied.push({ path: p.path, wasCreated: prev !== null, previousContent: null }); // previousContent not tracked for rollback
                continue;
            }
            // Validate path
            const repoAbs = safeRepoPath(p.path);
            const cur = await readFileSafe(repoAbs);
            previousContents[p.path] = cur;
            let newContent = null;
            if (typeof p.content === "string") {
                newContent = p.content;
            }
            else if (typeof p.diff === "string") {
                // apply unified diff to current content (or empty string)
                const base = cur ?? "";
                const patched = applyPatch(base, p.diff);
                if (patched === false || typeof patched !== "string") {
                    throw new Error(`Failed to apply patch for ${p.path}`);
                }
                newContent = patched;
            }
            else {
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
        }
        catch (err) {
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
            const message = filesToStage.length === 1
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
        }
        else {
            // nothing staged (shouldn't happen if applied not empty)
            return { ok: true, mode, applied, commitSha: null, rollbackMetadata: { previousContents } };
        }
    }
    catch (err) {
        return { ok: false, mode, applied, errors: [String(err?.message || err)] };
    }
}
/**
 * applyPatchesAndPush
 *
 * Convenience helper:
 *  - Applies patches (mode must be 'apply'; other modes will be forwarded to applyPatches).
 *  - If pushOptions provided, will create a branch, commit any applied files (applyPatches already commits),
 *    push the branch and open a PR via github.createBranchCommitPushPR.
 *
 * pushOptions:
 *  {
 *    branchName?: string; // if omitted, auto-generate repowriter/<timestamp>
 *    commitMessage?: string; // override the default commit message
 *    prBase?: string; // default "main"
 *    prTitle?: string;
 *    prBody?: string;
 *    authorName?: string;
 *    authorEmail?: string;
 *    pushRemote?: string;
 *    token?: string; // optional GitHub token
 *  }
 *
 * Returns an object combining ApplyResult and optional PR metadata.
 */
export async function applyPatchesAndPush(patches, mode = "apply", pushOptions) {
    // If mode !== 'apply', just delegate to applyPatches
    if (mode !== "apply") {
        const res = await applyPatches(patches, mode);
        return res;
    }
    // Apply patches (this will write files and commit them)
    const applyRes = await applyPatches(patches, "apply");
    if (!applyRes.ok) {
        return applyRes;
    }
    // If no pushOptions or pushOptions.branchName not provided and no PR desired, just return applyRes
    if (!pushOptions) {
        return applyRes;
    }
    // Prepare branch name
    const branchName = pushOptions.branchName || `repowriter/${Date.now()}`;
    // Determine files to include in commit/pr
    const files = (applyRes.applied || []).map(a => a.path);
    // If commitMessage provided, we want to create a new branch based on current HEAD and commit the files again with provided message.
    // But applyPatches already committed. To keep history clean, we'll create a new branch from current HEAD and re-commit the staged files if needed.
    // Strategy:
    // 1) Create a new branch from current HEAD
    // 2) Commit the files with the provided commitMessage (or reuse existing commit message)
    // 3) Push branch and create PR
    try {
        const commitMessage = pushOptions.commitMessage || (files.length === 1 ? `repowriter: apply ${files[0]}` : `repowriter: apply ${files.length} files`);
        const authorName = pushOptions.authorName;
        const authorEmail = pushOptions.authorEmail;
        const ghRes = await createBranchCommitPushPR(branchName, files, commitMessage, pushOptions.prBase || "main", pushOptions.prTitle || commitMessage, pushOptions.prBody || "", {
            authorName,
            authorEmail,
            pushRemote: pushOptions.pushRemote,
            token: pushOptions.token
        });
        return Object.assign({}, applyRes, { prUrl: ghRes.prUrl, prNumber: ghRes.prNumber, branch: ghRes.branch });
    }
    catch (err) {
        // Return applyRes but include error info
        const msg = String(err?.message || err);
        return Object.assign({}, applyRes, { ok: false, errors: (applyRes.errors || []).concat([`push/pr failed: ${msg}`]) });
    }
}
export default { applyPatches, applyPatchesAndPush };
