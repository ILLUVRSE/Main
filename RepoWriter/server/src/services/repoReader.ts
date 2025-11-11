/**
 * repoReader.ts
 *
 * Utilities to read repository files and produce a small context snapshot for the planner.
 * The helpers intentionally avoid reading large files in full and always ensure paths are
 * constrained to the configured REPO_PATH.
 */

import fs from "fs/promises";
import path from "path";
import fg from "fast-glob";
import { REPO_PATH } from "../config.js";

export type FileSnapshot = {
  path: string; // repository-relative path
  size: number;
  sample: string; // truncated content
};

function ensureRepoPath(candidate: string): string {
  if (!candidate || typeof candidate !== "string") {
    throw new Error("Invalid path");
  }
  if (candidate.includes("\0")) {
    throw new Error("Invalid path (null byte)");
  }
  // Prevent absolute path usage
  if (path.isAbsolute(candidate)) {
    // allow if it's exactly the repo root
    const resolved = path.resolve(candidate);
    if (resolved !== path.resolve(REPO_PATH)) {
      throw new Error("Absolute paths are not allowed");
    }
  }
  // Normalize the candidate relative to REPO_PATH
  const resolved = path.resolve(REPO_PATH, candidate);
  const repoRoot = path.resolve(REPO_PATH);
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
    throw new Error("Path escapes repository root");
  }
  return resolved;
}

export async function readFileRepo(relPath: string): Promise<string | null> {
  const abs = ensureRepoPath(relPath);
  try {
    return await fs.readFile(abs, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Return a string sample of the file limited to maxBytes (characters).
 * If the file is larger than maxBytes, returns the first maxBytes chars.
 */
export async function readFileSample(relPath: string, maxBytes = 2000): Promise<{ sample: string; size: number } | null> {
  const abs = ensureRepoPath(relPath);
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    const size = stat.size;
    const fd = await fs.open(abs, "r");
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, Math.max(1, Math.min(size, maxBytes))));
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      const sample = buf.toString("utf8", 0, bytesRead);
      return { sample, size };
    } finally {
      await fd.close();
    }
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * List repository files using fast-glob.
 * By default ignores node_modules, .git, and other common noise.
 * pattern is repo-relative glob (default: match files with an extension, e.g. "src/index.ts").
 */
export async function listRepoFiles(pattern = "**/*.*", maxResults = 1000): Promise<string[]> {
  const cwd = path.resolve(REPO_PATH);
  const entries = await fg(pattern, {
    cwd,
    onlyFiles: true,
    dot: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.next/**"],
    absolute: false,
    followSymbolicLinks: true,
    suppressErrors: true,
    deep: 6 // limit depth by default to be conservative
  });
  // Limit results
  return entries.slice(0, maxResults);
}

/**
 * Produce a compact repo context suitable for feeding into the planner:
 * - Prefer code files by extension
 * - Return up to maxFiles snapshots (path, size, sample)
 */
export async function getRepoContext(options?: {
  maxFiles?: number;
  maxBytesPerFile?: number;
  extensions?: string[]; // e.g., ['.ts','.js','.py']
}): Promise<FileSnapshot[]> {
  const { maxFiles = 20, maxBytesPerFile = 2000, extensions } = options || {};
  // Prefer code extensions if provided, otherwise a standard set
  const preferred = extensions ?? [".ts", ".js", ".jsx", ".tsx", ".py", ".go", ".java", ".rs", ".c", ".cpp", ".json", ".yaml", ".yml"];
  // Build glob patterns for preferred extensions
  const patterns = preferred.map((ext) => `**/*${ext}`);
  // Search preferred files first
  let files: string[] = [];
  for (const pat of patterns) {
    if (files.length >= maxFiles) break;
    const found = await listRepoFiles(pat, maxFiles * 2);
    for (const f of found) {
      if (!files.includes(f)) files.push(f);
      if (files.length >= maxFiles) break;
    }
  }

  // If not enough files found, broaden to any file
  if (files.length < maxFiles) {
    const more = await listRepoFiles("**/*.*", maxFiles * 2);
    for (const f of more) {
      if (files.length >= maxFiles) break;
      if (!files.includes(f)) files.push(f);
    }
  }

  // Map to snapshots, but cap bytes read per file
  const snapshots: FileSnapshot[] = [];
  for (const rel of files.slice(0, maxFiles)) {
    try {
      const s = await readFileSample(rel, maxBytesPerFile);
      if (!s) continue;
      snapshots.push({
        path: rel,
        size: s.size,
        sample: s.sample
      });
    } catch (err) {
      // ignore files we can't read
      continue;
    }
  }

  return snapshots;
}

export default {
  ensureRepoPath,
  readFileRepo,
  readFileSample,
  listRepoFiles,
  getRepoContext
};

