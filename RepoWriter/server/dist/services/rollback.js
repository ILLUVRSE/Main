/**
 * rollback.ts
 *
 * Helpers to rollback a commit or to apply rollback metadata (previousContents)
 * returned by the patcher after an apply.
 *
 * Changes:
 * - rollbackCommit now requires an explicit confirmation token when
 *   REPOWRITER_REQUIRE_ROLLBACK_CONFIRM=1 is set. This prevents accidental
 *   destructive resets from server runtime.
 *
 * Note: This function preserves backward compatibility: if the env flag is
 * not set, behavior is unchanged.
 */
import fs from "fs/promises";
import path from "path";
import simpleGit from "simple-git";
import { REPO_PATH, GIT_USER_NAME, GIT_USER_EMAIL } from "../config.js";
import gitSafety from "./gitSafety.js";
import { logInfo, logError } from "../telemetry/logger.js";
const git = simpleGit(REPO_PATH);
/** Ensure a repo-relative path is safe and return its absolute path. */
function safeRepoPath(candidate) {
    if (!candidate || typeof candidate !== "string") {
        throw new Error("Invalid path");
    }
    if (candidate.includes("\0")) {
        throw new Error("Invalid path (null byte)");
    }
    if (path.isAbsolute(candidate)) {
        throw new Error("Absolute paths not allowed");
    }
    const resolved = path.resolve(REPO_PATH, candidate);
    const repoRoot = path.resolve(REPO_PATH);
    if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
        throw new Error("Path escapes repository root");
    }
    return resolved;
}
/**
 * Roll back a single commit by resetting the repository to the parent of commitSha.
 * This is a hard reset and will modify working tree and HEAD.
 *
 * Security change:
 * If REPOWRITER_REQUIRE_ROLLBACK_CONFIRM === "1", a confirmation token is required.
 * The token must be passed in opts.confirmToken and equal the env var
 * REPOWRITER_ROLLBACK_TOKEN. This prevents accidental destructive resets from server.
 */
export async function rollbackCommit(commitSha, opts = {}) {
    try {
        if (!commitSha || typeof commitSha !== "string") {
            return { ok: false, error: "commitSha required" };
        }
        // If configured, require explicit confirmation token
        if (process.env.REPOWRITER_REQUIRE_ROLLBACK_CONFIRM === "1") {
            const provided = opts?.confirmToken || "";
            const required = process.env.REPOWRITER_ROLLBACK_TOKEN || "";
            if (!required) {
                // misconfiguration: refuse safe by default
                return { ok: false, error: "Rollback requires confirmation token but none configured on server" };
            }
            if (!provided || provided !== required) {
                return { ok: false, error: "Rollback not allowed: missing or invalid confirmation token" };
            }
        }
        // Verify commit exists
        try {
            await git.revparse([commitSha]);
        }
        catch (e) {
            return { ok: false, error: `commit not found: ${commitSha}` };
        }
        // Determine parent commit
        let parent;
        try {
            parent = (await git.revparse([`${commitSha}^`])).trim();
        }
        catch (e) {
            return { ok: false, error: `cannot determine parent of ${commitSha}: ${String(e?.message || e)}` };
        }
        logInfo(`rollback: resetting hard to parent ${parent} of ${commitSha}`);
        // Perform hard reset
        await git.reset(["--hard", parent]);
        return { ok: true };
    }
    catch (err) {
        logError(`rollbackCommit failed: ${String(err?.message || err)}`);
        return { ok: false, error: String(err?.message || err) };
    }
}
/**
 * Apply rollbackMetadata which is expected to be:
 * { previousContents: { "<path>": string | null, ... } }
 *
 * For each entry:
 *  - if previousContent === null -> delete the file
 *  - else write the previous content
 *
 * Then stage all affected files and commit with a repowriter rollback message.
 */
export async function applyRollbackMetadata(rollbackMetadata) {
    try {
        const prev = rollbackMetadata?.previousContents;
        if (!prev || typeof prev !== "object") {
            return { ok: false, error: "rollbackMetadata.previousContents required" };
        }
        // Ensure git user identity is set
        try {
            await gitSafety.ensureGitUser();
        }
        catch {
            // best-effort
        }
        const changedFiles = [];
        for (const [relPath, previousContent] of Object.entries(prev)) {
            try {
                const abs = safeRepoPath(relPath);
                if (previousContent === null) {
                    // delete file if exists
                    try {
                        await fs.unlink(abs);
                    }
                    catch (e) {
                        if (e?.code !== "ENOENT")
                            throw e;
                    }
                    changedFiles.push(relPath);
                }
                else {
                    // write previous content
                    await fs.mkdir(path.dirname(abs), { recursive: true });
                    await fs.writeFile(abs, previousContent, "utf8");
                    changedFiles.push(relPath);
                }
            }
            catch (e) {
                // If any file fails, abort and report error
                logError(`applyRollbackMetadata: failed to restore ${relPath}`, String(e?.message || e), { error: String(e?.message || e) });
                return { ok: false, error: `failed to restore ${relPath}: ${String(e?.message || e)}` };
            }
        }
        if (changedFiles.length === 0) {
            return { ok: true };
        }
        // Stage and commit changes with repowriter author
        try {
            await git.add(changedFiles);
            const author = `${GIT_USER_NAME} <${GIT_USER_EMAIL}>`;
            const message = `repowriter: rollback applied (${changedFiles.length} files)`;
            await git.commit(message, changedFiles, { "--author": author });
            return { ok: true };
        }
        catch (e) {
            logError(`applyRollbackMetadata: git commit failed`, String(e?.message || e), { error: String(e?.message || e) });
            return { ok: false, error: `git commit failed: ${String(e?.message || e)}` };
        }
    }
    catch (err) {
        logError(`applyRollbackMetadata unexpected error`, String(err?.message || err), { error: String(err?.message || err) });
        return { ok: false, error: String(err?.message || err) };
    }
}
export default {
    rollbackCommit,
    applyRollbackMetadata
};
