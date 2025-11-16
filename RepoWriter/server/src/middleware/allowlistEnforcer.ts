// RepoWriter/server/src/middleware/allowlistEnforcer.ts
//
// Middleware that enforces RepoWriter's repowriter_allowlist.json for incoming patch/apply requests.
//
// Behavior:
//  - Expects request body to include `patches: Array<{ path: string, content?: string, diff?: string }>`
//  - Rejects if any patch path is:
//      * absolute, or contains path traversal (`..` segments that escape repo root)
//      * starts with any configured forbidden path
//      * NOT under at least one configured allowed path
//  - Returns 400 with informative error JSON when rejected.
//
// Location of allowlist file:
//  - By default reads `repowriter_allowlist.json` from repository root (process.cwd()).
//  - If env `REPOWRITER_ALLOWLIST_PATH` is set, it will be used instead.
//
// Notes:
//  - This middleware performs prefix matching only (folder-style). For more advanced globbing,
//    the implementation can be extended to use `minimatch` or similar.

import type { Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";

type Patch = { path: string; content?: string; diff?: string };

type Allowlist = {
  allowed_paths: string[];
  forbidden_paths: string[];
};

const DEFAULT_ALLOWLIST = "repowriter_allowlist.json";

async function loadAllowlist(): Promise<Allowlist> {
  const allowPath =
    (process.env.REPOWRITER_ALLOWLIST_PATH || "").trim() || path.resolve(process.cwd(), DEFAULT_ALLOWLIST);

  try {
    const raw = await fs.readFile(allowPath, "utf8");
    const j = JSON.parse(raw);
    return {
      allowed_paths: Array.isArray(j.allowed_paths) ? j.allowed_paths : [],
      forbidden_paths: Array.isArray(j.forbidden_paths) ? j.forbidden_paths : [],
    };
  } catch (err: any) {
    // If file is missing, default to a conservative deny-all policy (no allowed_paths).
    console.warn(`[allowlistEnforcer] Could not load allowlist at ${allowPath}: ${err?.message || err}`);
    return { allowed_paths: [], forbidden_paths: [] };
  }
}

/**
 * Normalize a patch path into a repository-relative form:
 *  - reject absolute paths
 *  - normalize separators
 *  - prevent .. escaping the repo root
 */
function normalizePatchPath(p: string): string {
  if (!p || typeof p !== "string") throw new Error("invalid patch path");
  // Reject absolute paths
  if (path.isAbsolute(p)) throw new Error("absolute paths are forbidden");
  // Normalize and remove any leading ./ segments
  const norm = path.posix.normalize(p.replace(/^[\\/]+/, ""));
  // Prevent escaping via ../ that would go above repo root
  const parts = norm.split("/");
  let depth = 0;
  for (const part of parts) {
    if (part === "..") depth -= 1;
    else if (part === "." || part === "") continue;
    else depth += 1;
    if (depth < 0) throw new Error("path traversal outside repo root is forbidden");
  }
  // return normalized (posix) trimmed path (no leading ./)
  return norm.replace(/^\.\/+/g, "");
}

/**
 * Returns true if candidatePath starts with prefix (folder-style), both normalized using posix sep.
 * Ensures the matching is done by prefix segment (e.g., "src" matches "src/a" but not "src2/a").
 */
function pathStartsWithSegment(candidatePath: string, prefix: string): boolean {
  const cand = candidatePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const pref = prefix.replace(/\\/g, "/").replace(/^\/+/, "");
  if (pref === "") return false;
  if (cand === pref) return true;
  if (cand.startsWith(pref + "/")) return true;
  return false;
}

/**
 * allowlistEnforcer middleware factory
 *
 * Options:
 *  - bodyPatchesField: path in body where patches live (default: "patches")
 */
export function allowlistEnforcer(options?: { bodyPatchesField?: string }) {
  const patchesField = options?.bodyPatchesField || "patches";

  // Cache allowlist for a short time to avoid re-reading on every request
  let cached: { allowlist: Allowlist; mtimeMs: number } | null = null;
  const CACHE_TTL_MS = 5 * 1000; // 5 seconds

  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      const patches: Patch[] = (req.body && req.body[patchesField]) || [];
      if (!Array.isArray(patches)) {
        // Not our responsibility to validate shape fully; move on.
        return res.status(400).json({ ok: false, error: "invalid_patches" });
      }

      const allowPath =
        (process.env.REPOWRITER_ALLOWLIST_PATH || "").trim() || path.resolve(process.cwd(), DEFAULT_ALLOWLIST);

      // Reload allowlist if stale
      let allowlist: Allowlist;
      let statErr = null;
      try {
        const st = await fs.stat(allowPath).catch((e) => {
          statErr = e;
          return null;
        });
        const mtime = st?.mtimeMs || 0;
        if (!cached || Date.now() - (cached.mtimeMs || 0) > CACHE_TTL_MS || (st && cached.mtimeMs !== mtime)) {
          // re-read
          try {
            allowlist = await loadAllowlist();
            cached = { allowlist, mtimeMs: mtime };
          } catch (e) {
            // fallback to last cached if available
            if (cached) {
              allowlist = cached.allowlist;
            } else {
              allowlist = { allowed_paths: [], forbidden_paths: [] };
            }
          }
        } else {
          allowlist = cached.allowlist;
        }
      } catch (ex) {
        // Fallback: if cannot stat/read, use cached or empty allowlist
        if (cached) allowlist = cached.allowlist;
        else allowlist = { allowed_paths: [], forbidden_paths: [] };
      }

      // If allowed_paths is empty, be conservative: deny unless explicitly allowed in config.
      const allowed = allowlist.allowed_paths || [];
      const forbidden = allowlist.forbidden_paths || [];

      // Validate each patch
      for (const p of patches) {
        if (!p || typeof p.path !== "string") {
          return res.status(400).json({ ok: false, error: "invalid_patch_path" });
        }

        let normPath: string;
        try {
          normPath = normalizePatchPath(p.path);
        } catch (err: any) {
          return res.status(400).json({ ok: false, error: "forbidden_path_traversal", detail: String(err?.message || err) });
        }

        // Check forbidden prefixes first
        for (const forb of forbidden) {
          const forbNorm = (forb || "").replace(/\\/g, "/").replace(/^\/+/, "");
          if (forbNorm === "") continue;
          if (pathStartsWithSegment(normPath, forbNorm)) {
            return res.status(403).json({ ok: false, error: "path_forbidden", detail: normPath });
          }
        }

        // Then require allowed path membership
        let matchesAllowed = false;
        for (const allow of allowed) {
          const allowNorm = (allow || "").replace(/\\/g, "/").replace(/^\/+/, "");
          if (allowNorm === "") continue;
          if (pathStartsWithSegment(normPath, allowNorm)) {
            matchesAllowed = true;
            break;
          }
        }

        if (!matchesAllowed) {
          // If no allowed paths configured, deny by default
          return res.status(403).json({ ok: false, error: "path_not_allowed", detail: normPath });
        }
      }

      // All patches passed allowlist checks
      return next();
    } catch (err: any) {
      console.error("[allowlistEnforcer] unexpected error:", err);
      return res.status(500).json({ ok: false, error: "allowlist_check_failed", detail: String(err?.message || err) });
    }
  };
}

export default allowlistEnforcer;

