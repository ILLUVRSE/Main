/**
 * repo.ts
 *
 * Repo-related routes: list files, read file, create branch/commit/push, open PR.
 */

import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { REPO_PATH } from "../config.js";
import { createBranchAndCommit, pushBranch, createPullRequest, createBranchCommitPushPR, parseRemoteToRepoFullName } from "../services/gitHub.js";
import { applyPatches } from "../services/patcher.js";

const r = Router();

/** Simple repo file walker (skips ignored dirs) */
const DEFAULT_IGNORES = new Set([".git", "node_modules", "dist", "build", "out", "coverage"]);

/** Walk repo and collect files */
async function walkRepo(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const name = ent.name;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        if (DEFAULT_IGNORES.has(name)) continue;
        await walk(full);
      } else if (ent.isFile()) {
        out.push(path.relative(root, full));
      }
    }
  }
  await walk(root);
  return out;
}

/** Convert simple wildcard pattern to RegExp. Supports '*' -> '.*' */
function patternToRegExp(pattern: string) {
  // If pattern looks like **/*.* or contains glob markers, translate simply
  // Escape regex special chars then replace '*' with '.*'
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + esc.replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, ".*") + "$";
  return new RegExp(regexStr);
}

/**
 * GET /api/repo/list?pattern=...
 * Returns: { files: string[] }
 */
r.get("/list", async (req, res, next) => {
  try {
    const pattern = String(req.query.pattern ?? "**/*.*");
    const all = await walkRepo(REPO_PATH);
    let matcher: RegExp | null = null;
    if (pattern && pattern !== "**/*.*") {
      matcher = patternToRegExp(pattern);
    }
    const files = all
      .filter((f) => {
        if (!matcher) return true;
        return matcher!.test(f);
      })
      .sort();
    res.json({ files });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repo/file?path=...
 * Returns { content: string | null }
 */
r.get("/file", async (req, res, next) => {
  try {
    const p = String(req.query.path || "");
    if (!p) return res.status(400).json({ error: "missing path param" });
    // Prevent traversal
    if (p.startsWith("/") || p.includes("\0") || p.includes("..")) {
      return res.status(400).json({ error: "invalid path" });
    }
    const abs = path.resolve(REPO_PATH, p);
    try {
      const buf = await fs.readFile(abs, "utf8");
      res.json({ content: buf });
    } catch (err: any) {
      if (err?.code === "ENOENT") return res.json({ content: null });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/repo/branch-commit
 * Body: { branchName, files: string[], commitMessage, authorName?, authorEmail? }
 * Creates a local branch and commits listed files (must already be written in repo).
 */
r.post("/branch-commit", async (req, res, next) => {
  try {
    const { branchName, files, commitMessage, authorName, authorEmail } = req.body || {};
    if (!branchName || !commitMessage) {
      return res.status(400).json({ ok: false, error: "branchName and commitMessage are required" });
    }
    const fileList: string[] = Array.isArray(files) ? files : [];
    const result = await createBranchAndCommit(branchName, fileList, commitMessage, { authorName, authorEmail });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    next(err);
  }
});

/**
 * POST /api/repo/push
 * Body: { branch, remote? }
 */
r.post("/push", async (req, res, next) => {
  try {
    const { branch, remote } = req.body || {};
    if (!branch) return res.status(400).json({ ok: false, error: "branch required" });
    await pushBranch(branch, remote);
    res.json({ ok: true });
  } catch (err: any) {
    next(err);
  }
});

/**
 * POST /api/repo/pr
 * Body:
 *  {
 *    branchName, files: [{path, content? , diff?}] OR files: string[] (if already written),
 *    commitMessage,
 *    prBase?,
 *    prTitle?,
 *    prBody?,
 *    pushRemote?,
 *    authorName?, authorEmail?
 *  }
 *
 * If patches (with content/diff) are provided, apply them locally first (using patcher)
 * then create branch and commit the changed files, push and open PR.
 */
r.post("/pr", async (req, res, next) => {
  try {
    const {
      branchName,
      patches,
      files, // in case files already exist by path
      commitMessage,
      prBase,
      prTitle,
      prBody,
      pushRemote,
      authorName,
      authorEmail,
      token
    } = req.body || {};

    if (!branchName || !commitMessage) {
      return res.status(400).json({ ok: false, error: "branchName and commitMessage required" });
    }

    // If patches provided, apply them (applyPatches expects content/diff)
    if (Array.isArray(patches) && patches.length > 0) {
      // We will perform the apply in 'apply' mode so files are written to REPO_PATH.
      // Note: caller should ensure server process has permission to write to REPO_PATH.
      const applyResult = await applyPatches(patches, "apply");
      if (!applyResult.ok) {
        return res.status(500).json({ ok: false, error: "apply failed", details: applyResult });
      }
      // Prepare file list from applied entries
      const committedFiles = (applyResult.applied || []).map((a) => a.path);
      const ghRes = await createBranchCommitPushPR(branchName, committedFiles, commitMessage, prBase || "main", prTitle, prBody, {
        authorName,
        authorEmail,
        pushRemote,
        token
      });
      return res.json({ ok: true, ...ghRes });
    }

    // If files array provided (repo-relative paths), create branch, commit and PR
    if (Array.isArray(files) && files.length > 0) {
      const ghRes = await createBranchCommitPushPR(branchName, files, commitMessage, prBase || "main", prTitle, prBody, {
        authorName,
        authorEmail,
        pushRemote,
        token
      });
      return res.json({ ok: true, ...ghRes });
    }

    return res.status(400).json({ ok: false, error: "No patches or files provided" });
  } catch (err: any) {
    next(err);
  }
});

export default r;

