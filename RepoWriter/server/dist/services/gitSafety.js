/**
 * gitSafety.ts
 *
 * Helper wrappers around simple-git to ensure commits are authored correctly
 * and to provide a conservative surface for any git interaction the service needs.
 *
 * This module intentionally avoids performing pushes; it provides commit helpers
 * and safety checks so higher-level code can decide whether to push.
 */
import simpleGit from "simple-git";
import { REPO_PATH, GIT_USER_NAME, GIT_USER_EMAIL, GITHUB_REMOTE } from "../config.js";
const git = simpleGit(REPO_PATH);
/**
 * Ensure repository-local git config is set for author identity.
 */
export async function ensureGitUser() {
    try {
        // Only set if not already configured
        const name = (await git.raw(["config", "--get", "user.name"])).trim();
        const email = (await git.raw(["config", "--get", "user.email"])).trim();
        if (!name) {
            await git.addConfig("user.name", GIT_USER_NAME);
        }
        if (!email) {
            await git.addConfig("user.email", GIT_USER_EMAIL);
        }
    }
    catch {
        // best-effort; ignore errors here but allow callers to attempt commits later
    }
}
/**
 * Commit the specified files with a safe author and return the commit SHA.
 * This does NOT push to any remote.
 */
export async function commitFiles(files, message) {
    await ensureGitUser();
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error("commitFiles requires a non-empty files array");
    }
    // Stage files
    await git.add(files);
    // Use --author to ensure commit author
    const author = `${GIT_USER_NAME} <${GIT_USER_EMAIL}>`;
    await git.commit(message, files, { "--author": author });
    const sha = (await git.revparse(["HEAD"])).trim();
    return sha;
}
/**
 * Return the currently checked-out branch name.
 */
export async function getCurrentBranch() {
    const br = await git.branch();
    return br.current;
}
/**
 * Returns whether there are unstaged or staged changes in the working tree.
 */
export async function hasUncommittedChanges() {
    const status = await git.status();
    return status.files.length > 0;
}
/**
 * A guarded push function that refuses to push by default for safety.
 * If you truly need to push, call with force=true (but avoid doing so from server).
 */
export async function pushToRemote(force = false) {
    // Safety: default behavior is to refuse to push from server runtime.
    if (!force) {
        return { ok: false, error: "Push disabled by gitSafety; require explicit force=true to push." };
    }
    try {
        await git.push(GITHUB_REMOTE);
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
    }
}
export default {
    ensureGitUser,
    commitFiles,
    getCurrentBranch,
    hasUncommittedChanges,
    pushToRemote
};
