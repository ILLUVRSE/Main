/**
 * gitHub.ts
 *
 * Helpers for creating branches, pushing and opening PRs.
 *
 * NOTES / Requirements:
 *  - Local git must be available on the server.
 *  - Pushing requires that the server's git environment is configured to authenticate
 *    with the remote (e.g., SSH key loaded, or remote URL using token).
 *  - For PR creation, provide GITHUB_TOKEN or pass token to createPullRequest().
 *
 * Exports:
 *  - getRepoFullName(): Promise<string>  // owner/repo
 *  - createBranchAndCommit(branchName, files, commitMessage, author?): Promise<{ branch: string }>
 *  - pushBranch(branchName, remote?): Promise<void>
 *  - createPullRequest(branchName, base, title, body, token?): Promise<{ url, number }>
 */

import path from "path";
import fetch from "node-fetch";
import simpleGit, { SimpleGit } from "simple-git";
import { REPO_PATH, GITHUB_REMOTE, GIT_USER_NAME, GIT_USER_EMAIL } from "../config.js";

type CreateCommitOpts = {
  authorName?: string;
  authorEmail?: string;
};

function getGitClient(): SimpleGit {
  const git = simpleGit(REPO_PATH);
  return git;
}

/** Parse remote URL to owner/repo (github.com) */
async function parseRemoteToRepoFullName(remoteName = GITHUB_REMOTE): Promise<string> {
  const git = getGitClient();
  try {
    // Try to get remote URL via git
    const url = await git.remote(["get-url", remoteName]) as string;
    if (!url) throw new Error("empty remote url");
    // examples:
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo.git
    // https://x-access-token:xxxxx@github.com/owner/repo.git
    let m = null;
    if (url.startsWith("git@")) {
      // git@github.com:owner/repo.git
      m = url.match(/^[^:]+:([^/]+\/[^.]+)(?:\.git)?$/);
      if (m) return m[1].replace(/\.git$/, "");
    } else {
      // https://...github.com/owner/repo.git
      m = url.match(/github\.com[:\/]([^\/]+\/[^.]+)(?:\.git)?$/);
      if (m) return m[1].replace(/\.git$/, "");
    }
    // fallback: if GITHUB_REPO env present
    if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO;
    throw new Error(`Unable to parse remote URL: ${url}`);
  } catch (err: any) {
    // fallback to env var
    if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO;
    throw new Error(`Failed to determine repo full name: ${String(err?.message || err)}`);
  }
}

/**
 * Create a new branch locally, add files, commit with message and author.
 * Does not push. Returns branch name.
 */
export async function createBranchAndCommit(
  branchName: string,
  files: string[],
  commitMessage: string,
  opts: CreateCommitOpts = {}
): Promise<{ branch: string; commitSha?: string }> {
  if (!branchName) throw new Error("branchName required");
  const git = getGitClient();

  // checkout new branch (create)
  await git.checkoutLocalBranch(branchName);

  // stage files (paths should be repo-relative)
  if (files && files.length > 0) {
    await git.add(files);
  } else {
    // nothing to add
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
export async function pushBranch(branchName: string, remote = GITHUB_REMOTE): Promise<void> {
  const git = getGitClient();
  if (!branchName) throw new Error("branchName required for push");
  // push branch and set upstream
  await git.push(remote, branchName, { "-u": null });
}

/**
 * Create a pull request using the GitHub REST API.
 * token: personal access token or GITHUB_TOKEN in env.
 */
export async function createPullRequest(
  branch: string,
  base = "main",
  title?: string,
  body?: string,
  token?: string
): Promise<{ url: string; number: number }> {
  if (!branch) throw new Error("branch is required");
  const ghToken = token || process.env.GITHUB_TOKEN;
  if (!ghToken) throw new Error("GITHUB_TOKEN not set (or pass token param)");

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
 */
export async function createBranchCommitPushPR(
  branchName: string,
  files: string[],
  commitMessage: string,
  prBase = "main",
  prTitle?: string,
  prBody?: string,
  opts: { authorName?: string; authorEmail?: string; pushRemote?: string; token?: string } = {}
) : Promise<{ branch: string; commitSha?: string; prUrl?: string; prNumber?: number }> {
  const res = await createBranchAndCommit(branchName, files, commitMessage, { authorName: opts.authorName, authorEmail: opts.authorEmail });
  const pushRemote = opts.pushRemote || GITHUB_REMOTE;
  await pushBranch(branchName, pushRemote);

  // create PR
  const pr = await createPullRequest(branchName, prBase, prTitle || commitMessage, prBody || "", opts.token);
  return { branch: branchName, commitSha: res.commitSha, prUrl: pr.url, prNumber: pr.number };
}

/**
 * Utility: determine remote default branch by querying GitHub. (Optional)
 */
export async function getRepoDefaultBranch(token?: string): Promise<string> {
  const ghToken = token || process.env.GITHUB_TOKEN;
  const repoFull = await parseRemoteToRepoFullName();
  const [owner, repo] = repoFull.split("/");
  if (!ghToken) {
    // fallback to main
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

