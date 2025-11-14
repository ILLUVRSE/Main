/**
 * gitHub.ts
 *
 * Helpers for creating branches, pushing and opening PRs.
 *
 * Added: allowlist enforcement and audit logging (repowriter_allowlist.json & audit.log)
 */
import path from "path";
import fs from "fs/promises";
import fetch from "node-fetch";
import simpleGit from "simple-git";
import { REPO_PATH, GITHUB_REMOTE, GIT_USER_NAME, GIT_USER_EMAIL } from "../config.js";
import auditLog from "../services/auditLog.js";
/** Allowlist file path */
const ALLOWLIST_FILE = path.join(REPO_PATH, "repowriter_allowlist.json");
function normalizeRel(p) {
    // normalize and use forward-slash style
    return path.normalize(p).replace(/\\/g, "/").replace(/^\/+/, "");
}
async function loadAllowlist() {
    try {
        const raw = await fs.readFile(ALLOWLIST_FILE, "utf8");
        const parsed = JSON.parse(raw);
        parsed.allowed_paths = Array.isArray(parsed.allowed_paths) ? parsed.allowed_paths : [];
        parsed.forbidden_paths = Array.isArray(parsed.forbidden_paths) ? parsed.forbidden_paths : [];
        return parsed;
    }
    catch {
        // conservative default: no allowed paths (will reject)
        return { allowed_paths: [], forbidden_paths: [] };
    }
}
function pathIsForbidden(rel, allow) {
    const nf = normalizeRel(rel);
    for (const forbRaw of (allow.forbidden_paths || [])) {
        if (!forbRaw)
            continue;
        const forb = normalizeRel(forbRaw);
        if (nf === forb || nf.startsWith(forb + "/"))
            return true;
    }
    return false;
}
function pathIsAllowedByPrefix(rel, allow) {
    const np = normalizeRel(rel);
    const allowed = allow.allowed_paths || [];
    if (!Array.isArray(allowed) || allowed.length === 0) {
        // conservative: if none defined, nothing is allowed
        return false;
    }
    for (const prefRaw of allowed) {
        if (!prefRaw)
            continue;
        const pref = normalizeRel(prefRaw);
        if (np === pref || np.startsWith(pref))
            return true;
    }
    return false;
}
function ensureFilesAllowed(files, allow) {
    const bad = [];
    for (const f of files) {
        const rel = normalizeRel(f);
        if (pathIsForbidden(rel, allow) || !pathIsAllowedByPrefix(rel, allow)) {
            bad.push(rel);
        }
    }
    if (bad.length) {
        throw new Error(`Refusing to commit files outside allowed paths or touching forbidden paths: ${bad.join(", ")}`);
    }
}
/** Git client helper */
function getGitClient() {
    const git = simpleGit(REPO_PATH);
    return git;
}
/** Parse remote URL to owner/repo (github.com) */
async function parseRemoteToRepoFullName(remoteName = GITHUB_REMOTE) {
    const git = getGitClient();
    try {
        const url = await git.remote(["get-url", remoteName]);
        if (!url)
            throw new Error("empty remote url");
        let m = null;
        if (url.startsWith("git@")) {
            m = url.match(/^[^:]+:([^/]+\/[^.]+)(?:\.git)?$/);
            if (m)
                return m[1].replace(/\.git$/, "");
        }
        else {
            m = url.match(/github\.com[:\/]([^\/]+\/[^.]+)(?:\.git)?$/);
            if (m)
                return m[1].replace(/\.git$/, "");
        }
        if (process.env.GITHUB_REPO)
            return process.env.GITHUB_REPO;
        throw new Error(`Unable to parse remote URL: ${url}`);
    }
    catch (err) {
        if (process.env.GITHUB_REPO)
            return process.env.GITHUB_REPO;
        throw new Error(`Failed to determine repo full name: ${String(err?.message || err)}`);
    }
}
/**
 * Create a new branch locally, add files, commit with message and author.
 * Does not push. Returns branch name.
 *
 * Security: Enforces repowriter_allowlist.json before staging files.
 */
export async function createBranchAndCommit(branchName, files, commitMessage, opts = {}) {
    if (!branchName)
        throw new Error("branchName required");
    const git = getGitClient();
    // Load allowlist and enforce it for each file
    const allow = await loadAllowlist();
    ensureFilesAllowed(files || [], allow);
    // checkout new branch (create)
    await git.checkoutLocalBranch(branchName);
    // stage files (paths should be repo-relative)
    if (files && files.length > 0) {
        await git.add(files);
    }
    // commit
    const authorName = opts.authorName || GIT_USER_NAME || "repowriter-bot";
    const authorEmail = opts.authorEmail || GIT_USER_EMAIL || "noreply@repowriter";
    await git.commit(commitMessage, files, { "--author": `${authorName} <${authorEmail}>` });
    // Get last commit sha
    const sha = await git.revparse(["HEAD"]);
    return { branch: branchName, commitSha: sha };
}
/**
 * Push branch to remote (default remote from config).
 * Requires that the server-side git is configured to authenticate with the remote.
 */
export async function pushBranch(branchName, remote = GITHUB_REMOTE) {
    const git = getGitClient();
    if (!branchName)
        throw new Error("branchName required for push");
    await git.push(remote, branchName, { "-u": null });
}
/**
 * Create a pull request using the GitHub REST API.
 * token: personal access token or GITHUB_TOKEN in env.
 */
export async function createPullRequest(branch, base = "main", title, body, token) {
    if (!branch)
        throw new Error("branch is required");
    const ghToken = token || process.env.GITHUB_TOKEN;
    if (!ghToken)
        throw new Error("GITHUB_TOKEN not set (or pass token param)");
    const repoFull = await parseRemoteToRepoFullName();
    const [owner, repo] = repoFull.split("/");
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls`;
    const payload = {
        title: title || `Repowriter: changes on ${branch}`,
        head: branch,
        base,
        body: body || ""
    };
    const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Authorization": `token ${ghToken}`,
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    const j = await res.json();
    return { url: j.html_url, number: j.number };
}
/**
 * Convenience: create branch, commit files, push and open PR.
 * Returns { branch, commitSha, prUrl, prNumber }
 *
 * This function now records audit entries for attempt/success/failure.
 */
export async function createBranchCommitPushPR(branchName, files, commitMessage, prBase = "main", prTitle, prBody, opts = {}) {
    // Log attempt
    await auditLog.logAction({
        action: "create-branch-commit:attempt",
        user: process.env.REPOWRITER_USER || null,
        files,
        branch: branchName,
        ok: false
    });
    try {
        const res = await createBranchAndCommit(branchName, files, commitMessage, { authorName: opts.authorName, authorEmail: opts.authorEmail });
        const pushRemote = opts.pushRemote || GITHUB_REMOTE;
        await pushBranch(branchName, pushRemote);
        // create PR
        const pr = await createPullRequest(branchName, prBase, prTitle || commitMessage, prBody || "", opts.token);
        // Log success
        await auditLog.logAction({
            action: "create-branch-commit:success",
            user: process.env.REPOWRITER_USER || null,
            files,
            branch: branchName,
            prUrl: pr.url,
            ok: true
        });
        return { branch: branchName, commitSha: res.commitSha, prUrl: pr.url, prNumber: pr.number };
    }
    catch (err) {
        // Log failure
        try {
            await auditLog.logAction({
                action: "create-branch-commit:failure",
                user: process.env.REPOWRITER_USER || null,
                files,
                branch: branchName,
                ok: false,
                meta: { error: String(err?.message || err) }
            });
        }
        catch { }
        throw err;
    }
}
/**
 * Utility: determine remote default branch by querying GitHub. (Optional)
 */
export async function getRepoDefaultBranch(token) {
    const ghToken = token || process.env.GITHUB_TOKEN;
    const repoFull = await parseRemoteToRepoFullName();
    const [owner, repo] = repoFull.split("/");
    if (!ghToken) {
        return "main";
    }
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const res = await fetch(apiUrl, {
        headers: {
            "Authorization": `token ${ghToken}`,
            "Accept": "application/vnd.github.v3+json"
        }
    });
    if (!res.ok) {
        return "main";
    }
    const j = await res.json();
    return j.default_branch || "main";
}
export default {
    parseRemoteToRepoFullName,
    createBranchAndCommit,
    pushBranch,
    createPullRequest,
    createBranchCommitPushPR,
    getRepoDefaultBranch
};
