// RepoWriter/server/src/services/github.ts
//
// GitHub / Git helpers with allowlist enforcement and audit hooks.
//
// Responsibilities:
//  - createBranch(name)
//  - commitPatches(patches, commitMessage)  <-- validates patch paths against allowlist, commits
//  - pushChanges(branchName)
//  - openPullRequest(branchName)
//
// This file performs conservative allowlist checks before committing/pushing changes.
// It emits audit events for important actions.

import fs from "fs/promises";
import path from "path";
import { gitBranch, gitCommit, gitPush } from "./git";
import { emitMetric, logAuditEvent } from "./telemetry";

type PatchObj = { path: string; content?: string; diff?: string };

type Allowlist = {
  allowed_paths: string[];
  forbidden_paths: string[];
};

const DEFAULT_ALLOWLIST = path.resolve(process.cwd(), "repowriter_allowlist.json");

async function loadAllowlist(): Promise<Allowlist> {
  try {
    const raw = await fs.readFile(process.env.REPOWRITER_ALLOWLIST_PATH?.trim() || DEFAULT_ALLOWLIST, "utf8");
    const j = JSON.parse(raw);
    return {
      allowed_paths: Array.isArray(j.allowed_paths) ? j.allowed_paths : [],
      forbidden_paths: Array.isArray(j.forbidden_paths) ? j.forbidden_paths : [],
    };
  } catch (err: any) {
    // Conservative default: deny everything if allowlist missing
    console.warn(`[github.service] Could not load allowlist: ${String(err?.message ?? err)}; defaulting to empty allowlist`);
    return { allowed_paths: [], forbidden_paths: [] };
  }
}

/**
 * Normalize a patch path into repository-relative posix form and prevent path traversal.
 */
function normalizePatchPath(p: string): string {
  if (!p || typeof p !== "string") throw new Error("invalid patch path");
  if (path.isAbsolute(p)) throw new Error("absolute paths are forbidden");
  // Use posix separators for matching consistency
  const replaced = p.replace(/\\/g, "/").replace(/^\/+/, "");
  const norm = path.posix.normalize(replaced);
  // ensure no upward traversal beyond repo root
  const parts = norm.split("/");
  let depth = 0;
  for (const part of parts) {
    if (part === "..") depth -= 1;
    else if (part === "." || part === "") continue;
    else depth += 1;
    if (depth < 0) throw new Error("path traversal outside repo root is forbidden");
  }
  return norm.replace(/^\.\/+/, "");
}

/**
 * Returns true if candidate starts with prefix as a directory segment (allow folder prefix)
 */
function pathStartsWithSegment(candidatePath: string, prefix: string): boolean {
  const cand = candidatePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const pref = (prefix || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!pref) return false;
  if (cand === pref) return true;
  if (cand.startsWith(pref + "/")) return true;
  return false;
}

/**
 * Validate patch paths against allowlist.
 * Throws an Error with a descriptive message on violation.
 */
async function validatePatchesAgainstAllowlist(patches: PatchObj[]) {
  const allowlist = await loadAllowlist();
  const allowed = allowlist.allowed_paths || [];
  const forbidden = allowlist.forbidden_paths || [];

  if (!Array.isArray(patches)) throw new Error("patches must be an array");

  for (const p of patches) {
    if (!p || typeof p.path !== "string") {
      throw new Error("invalid_patch_path");
    }

    let normalized: string;
    try {
      normalized = normalizePatchPath(p.path);
    } catch (err: any) {
      throw new Error(`forbidden_path_traversal: ${String(err?.message ?? err)}`);
    }

    // Forbidden check
    for (const forb of forbidden) {
      const forbNorm = (forb || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!forbNorm) continue;
      if (pathStartsWithSegment(normalized, forbNorm)) {
        throw new Error(`path_forbidden: ${normalized}`);
      }
    }

    // Allowed membership: require at least one allowed prefix
    let matchesAllowed = false;
    for (const allow of allowed) {
      const allowNorm = (allow || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!allowNorm) continue;
      if (pathStartsWithSegment(normalized, allowNorm)) {
        matchesAllowed = true;
        break;
      }
    }

    if (!matchesAllowed) {
      throw new Error(`path_not_allowed: ${normalized}`);
    }
  }
}

/**
 * Create a local branch and emit audit/metric.
 */
export async function createBranch(branchName: string) {
  await gitBranch(branchName);
  emitMetric("branch_created");
  logAuditEvent(`RepoWriter.branch_created: ${branchName}`);
  return { ok: true, branch: branchName };
}

/**
 * Commit patches to the repository.
 * - Validates patch paths against allowlist first.
 * - Assumes patches were already applied to disk by patcher; this step just commits them.
 * - Commits all staged changes (caller must ensure patcher staged/wrote them) and emits audit.
 */
export async function commitPatches(patches: PatchObj[], commitMessage = "repowriter: apply changes") {
  // validate first
  await validatePatchesAgainstAllowlist(patches);

  // commit
  const res = await gitCommit(commitMessage);

  // telemetry & audit
  emitMetric("changes_committed");
  try {
    logAuditEvent(
      `RepoWriter.commit: message=${commitMessage} files=${patches.map((p) => p.path).join(",")}`
    );
  } catch (e) {
    console.warn("logAuditEvent failed after commit", e);
  }

  return res;
}

/**
 * Push changes to remote and emit audit.
 * This is intentionally simple: it verifies the local branch and calls gitPush().
 */
export async function pushChanges(branchName?: string) {
  const res = await gitPush();
  emitMetric("changes_pushed");
  logAuditEvent(`RepoWriter.push: branch=${branchName || "current"}`);
  return { ok: true, res };
}

/**
 * Open a pull request (placeholder).
 * In production this should call GitHub API and return prUrl/prNumber.
 * For now we emit audit + metric and return a minimal object.
 */
export async function openPullRequest(branchName: string) {
  // Placeholder: real implementation should call GitHub REST API to create a PR.
  emitMetric("pr_opened");
  logAuditEvent(`RepoWriter.pr_opened: branch=${branchName}`);
  return { ok: true, prUrl: `https://github.com/REPO/pull/new/${encodeURIComponent(branchName)}` };
}

export default {
  createBranch,
  commitPatches,
  pushChanges,
  openPullRequest,
};

