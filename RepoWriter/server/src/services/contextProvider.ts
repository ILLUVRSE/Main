/**
 * contextProvider.ts
 *
 * Build a token-bounded repo context payload for the planner.
 *
 * Strategy:
 *  - Walk repo files (skipping node_modules, .git, build dirs).
 *  - Score files by simple lexical match of prompt words in filename/content.
 *  - Read top-scoring files (up to maxFileBytes) and produce:
 *      { path, content (truncated), snippet, summary, tokensEstimate }
 *  - Return files until token budget is exhausted.
 *
 * Optionally will call an embeddings index (if present) for semantic retrieval
 * (embeddingsIndex service will be created in a later file).
 */

import fs from "fs/promises";
import path from "path";
import { REPO_PATH } from "../config.js";

export type ContextFile = {
  path: string; // repo-relative path
  content: string; // truncated content
  snippet: string; // short snippet (first non-empty lines)
  summary: string; // heuristic summary (first comment block or first lines)
  tokensEstimate: number;
  sizeBytes: number;
};

export type ContextOptions = {
  // how many top files to return (after token budget)
  topK?: number;

  // maximum tokens that should be returned in total (approximate)
  tokenBudget?: number;

  // maximum file bytes to read per file (default 64KB)
  maxFileBytes?: number;

  // minimum lexical score to consider a file relevant
  minScore?: number;

  // globs or top-level paths to prefer (optional)
  preferPaths?: string[];

  // whether to use embeddingsIndex if available
  useEmbeddings?: boolean;
};

const DEFAULTS: Required<ContextOptions> = {
  topK: 8,
  tokenBudget: 1500,
  maxFileBytes: 64 * 1024,
  minScore: 0.1,
  preferPaths: [],
  useEmbeddings: false
};

/** Very rough token estimate: characters / 4 */
function estimateTokensFromChars(chars: number) {
  return Math.ceil(chars / 4);
}

/** Read a file safely with max bytes */
async function readFileSafeLimited(absPath: string, maxBytes: number): Promise<{content: string, size: number}> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return { content: "", size: 0 };
    const size = stat.size;
    const fd = await fs.open(absPath, "r");
    try {
      const toRead = Math.min(size, maxBytes);
      const buf = Buffer.alloc(toRead);
      await fd.read(buf, 0, toRead, 0);
      // If truncated, append a marker
      let content = buf.toString("utf8");
      if (toRead < size) content += "\n...[truncated]";
      return { content, size };
    } finally {
      await fd.close();
    }
  } catch {
    return { content: "", size: 0 };
  }
}

/** Extract a short snippet: first few non-empty lines. */
function extractSnippet(content: string, maxLines = 6) {
  const lines = content.split(/\r?\n/).map(l => l.trim());
  const nonEmpty = lines.filter(l => l.length > 0);
  return nonEmpty.slice(0, maxLines).join("\n");
}

/** Heuristic summary: try to find a top-level comment block or fall back to first lines */
function heuristicSummary(content: string, maxChars = 400) {
  // Look for block comments at the top: /* ... */ or // lines
  const trimmed = content.trim();
  if (!trimmed) return "";
  // Check for /** ... */ style
  const blockMatch = trimmed.match(/^\/\*\*?([\s\S]*?)\*\//);
  if (blockMatch && blockMatch[1]) {
    const s = blockMatch[1].replace(/\r?\n\s*\*?/g, " ").trim();
    return s.slice(0, maxChars);
  }
  // Check for starting line comments //
  const lines = trimmed.split(/\r?\n/).slice(0, 20);
  const commentLines = lines.filter(l => l.trim().startsWith("//") || l.trim().startsWith("#"));
  if (commentLines.length > 0) {
    const t = commentLines.map(l => l.replace(/^(\s*\/\/\s?|\s*#\s?)/, "")).join(" ");
    return t.slice(0, maxChars);
  }
  // Fallback: first non-empty text chunk
  return extractSnippet(trimmed, 5).slice(0, maxChars);
}

/** Token-bounded aggregator */
function truncateContentToTokens(content: string, maxTokens: number) {
  const estTokens = estimateTokensFromChars(content.length);
  if (estTokens <= maxTokens) return content;
  // approximate by chars
  const maxChars = Math.floor(maxTokens * 4);
  return content.slice(0, Math.max(0, maxChars)) + "\n...[truncated]";
}

/** Simple lexical scoring on filename + content */
function lexicalScore(promptWords: string[], filename: string, contentSample: string) {
  const name = filename.toLowerCase();
  let score = 0;
  for (const w of promptWords) {
    if (!w) continue;
    if (name.includes(w)) score += 2;
    // occurrences in sample
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = (contentSample.match(re) || []).length;
    score += Math.min(10, matches) * 0.25;
  }
  return score;
}

/** Walk repository and collect candidate files */
async function collectFiles(root: string) {
  const out: string[] = [];
  const ignoreDirs = new Set([".git", "node_modules", "dist", "build", "out", "coverage"]);
  async function walk(dir: string) {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const name = ent.name;
      if (ent.isDirectory()) {
        if (ignoreDirs.has(name)) continue;
        await walk(path.join(dir, name));
      } else if (ent.isFile()) {
        // skip binary-ish files by extension
        if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".gif") || name.endsWith(".wasm")) continue;
        out.push(path.relative(root, path.join(dir, name)));
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * Build context for a prompt.
 * Returns files in order of importance until tokenBudget is consumed or topK reached.
 */
export async function buildContext(prompt: string, opts: ContextOptions = {}): Promise<{ files: ContextFile[]; totalTokens: number }> {
  const conf = Object.assign({}, DEFAULTS, opts || {});
  const promptWords = Array.from(new Set(
    (prompt || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  ));

  // If embeddings retrieval is enabled, defer to embeddingsIndex (if implemented)
  if (conf.useEmbeddings) {
    try {
      // dynamic import to avoid hard dependency; embeddingsIndex.ts will be implemented later.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { queryEmbeddings } = await import("./embeddingsIndex.js");
      if (typeof queryEmbeddings === "function") {
        const hits = await queryEmbeddings(prompt, { topK: conf.topK * 2 });
        // hits => [{ path, score }]
        const files: ContextFile[] = [];
        let totalTokens = 0;
        for (const h of hits) {
          if (!h || !h.path) continue;
          const abs = path.resolve(REPO_PATH, h.path);
          const { content, size } = await readFileSafeLimited(abs, conf.maxFileBytes);
          const summary = heuristicSummary(content);
          const snippet = extractSnippet(content);
          const tokensEstimate = estimateTokensFromChars(content.length);
          if (totalTokens + tokensEstimate > conf.tokenBudget && files.length >= 1) break;
          files.push({ path: h.path, content, snippet, summary, tokensEstimate, sizeBytes: size });
          totalTokens += tokensEstimate;
          if (files.length >= conf.topK) break;
        }
        return { files, totalTokens };
      }
    } catch {
      // ignore if embeddingsIndex not available
    }
  }

  // Lexical fallback
  const candidates = await collectFiles(REPO_PATH);
  const scored: { path: string; score: number; sample: string }[] = [];
  // For performance, sample first N bytes of each file for scoring
  const sampleBytes = 8 * 1024;
  for (const rel of candidates) {
    try {
      const abs = path.resolve(REPO_PATH, rel);
      const { content } = await readFileSafeLimited(abs, sampleBytes);
      const score = lexicalScore(promptWords, rel, content);
      if (score > 0) scored.push({ path: rel, score, sample: content });
    } catch {
      // ignore unreadable files
    }
  }

  // Boost preferred paths
  if (conf.preferPaths && conf.preferPaths.length > 0) {
    for (const s of scored) {
      for (const p of conf.preferPaths) {
        if (s.path.startsWith(p)) s.score *= 1.5;
      }
    }
  }

  // Sort by score desc
  scored.sort((a, b) => b.score - a.score);

  const files: ContextFile[] = [];
  let totalTokens = 0;

  for (const c of scored) {
    if (files.length >= conf.topK) break;
    // Stop if token budget exhausted
    if (totalTokens >= conf.tokenBudget) break;
    if (c.score < conf.minScore) break;

    try {
      const abs = path.resolve(REPO_PATH, c.path);
      const { content, size } = await readFileSafeLimited(abs, conf.maxFileBytes);
      const summary = heuristicSummary(content);
      const snippet = extractSnippet(content);
      let tokensEstimate = estimateTokensFromChars(content.length);
      // If adding this file would bust the budget, truncate content
      if (totalTokens + tokensEstimate > conf.tokenBudget) {
        const remaining = Math.max(0, conf.tokenBudget - totalTokens);
        const truncated = truncateContentToTokens(content, remaining);
        tokensEstimate = estimateTokensFromChars(truncated.length);
        files.push({ path: c.path, content: truncated, snippet: extractSnippet(truncated), summary, tokensEstimate, sizeBytes: size });
        totalTokens += tokensEstimate;
        break;
      } else {
        files.push({ path: c.path, content, snippet, summary, tokensEstimate, sizeBytes: size });
        totalTokens += tokensEstimate;
      }
    } catch {
      continue;
    }
  }

  return { files, totalTokens };
}

export default { buildContext };

