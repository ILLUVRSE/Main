/**
 * web/src/services/context.ts
 *
 * Client-side helper for building repo context for planner UI.
 *
 * - Tries server /api/context/build first (if server implements it).
 * - Falls back to a lightweight client-side lexical scorer that uses api.listRepoFiles/getRepoFile.
 *
 * Note: This mirrors the server-side ContextFile shape so front-end components can consume
 * results uniformly whether the server builds context or the client does a local fallback.
 */

import api from "./api.ts";

export type ContextFile = {
  path: string;
  content: string;
  snippet: string;
  summary: string;
  tokensEstimate: number;
  sizeBytes: number;
};

export type ContextOptions = {
  topK?: number;
  tokenBudget?: number;
  maxFileBytes?: number;
  minScore?: number;
  preferPaths?: string[];
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

/** Heuristic tokens estimate (chars / 4). */
function estimateTokensFromChars(chars: number) {
  return Math.max(1, Math.ceil(chars / 4));
}

/** Extract first non-empty lines as a snippet. */
function extractSnippet(content: string, maxLines = 6) {
  const lines = content.split(/\r?\n/).map(l => l.trim());
  const nonEmpty = lines.filter(l => l.length > 0);
  return nonEmpty.slice(0, maxLines).join("\n");
}

/** Heuristic summary (first comment block or top lines). */
function heuristicSummary(content: string, maxChars = 400) {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const blockMatch = trimmed.match(/^\/\*\*?([\s\S]*?)\*\//);
  if (blockMatch && blockMatch[1]) {
    const s = blockMatch[1].replace(/\r?\n\s*\*?/g, " ").trim();
    return s.slice(0, maxChars);
  }
  const lines = trimmed.split(/\r?\n/).slice(0, 20);
  const commentLines = lines.filter(l => l.trim().startsWith("//") || l.trim().startsWith("#"));
  if (commentLines.length > 0) {
    const t = commentLines.map(l => l.replace(/^(\s*\/\/\s?|\s*#\s?)/, "")).join(" ");
    return t.slice(0, maxChars);
  }
  return extractSnippet(trimmed, 5).slice(0, maxChars);
}

/** Simple lexical scoring on filename + sample content */
function lexicalScore(promptWords: string[], filename: string, contentSample: string) {
  const name = filename.toLowerCase();
  let score = 0;
  for (const w of promptWords) {
    if (!w) continue;
    if (name.includes(w)) score += 2;
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = (contentSample.match(re) || []).length;
    score += Math.min(10, matches) * 0.25;
  }
  return score;
}

/**
 * Try server-side build first; if it fails, fallback to client heuristic.
 *
 * Returns { files: ContextFile[], totalTokens: number }
 */
export async function buildContext(prompt: string, opts: ContextOptions = {}): Promise<{ files: ContextFile[]; totalTokens: number }> {
  const conf = Object.assign({}, DEFAULTS, opts || {});
  // Attempt server-side endpoint
  try {
    // Determine API base (mirror logic from web client: localStorage override or default)
    let apiBase = "";
    try {
      // Try to read the same localStorage key used by the app
      // eslint-disable-next-line no-undef
      const stored = (localStorage && localStorage.getItem && localStorage.getItem("repowriter_api_base")) || "";
      apiBase = stored && stored.trim() ? stored.trim() : "http://localhost:7071";
    } catch {
      apiBase = "http://localhost:7071";
    }
    const resp = await fetch(`${apiBase.replace(/\/$/, "")}/api/context/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, options: conf })
    });
    if (resp.ok) {
      const j = await resp.json();
      // Expect { files, totalTokens }
      if (j && Array.isArray(j.files)) return { files: j.files as ContextFile[], totalTokens: j.totalTokens ?? 0 };
    }
    // fallthrough to client fallback if server returns non-ok or unexpected shape
  } catch {
    // ignore and fallback to client-side implementation
  }

  // Client-side fallback:
  // - list repo files via api.listRepoFiles
  // - sample first N bytes for scoring
  // - sort by lexical score and return top files truncated to tokenBudget
  const promptWords = Array.from(new Set(
    (prompt || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  ));

  const allFiles = await api.listRepoFiles("**/*.*");
  // Sample first M files for efficiency; allow preferPaths to bump priority
  const sampleBytes = Math.min(conf.maxFileBytes, 8 * 1024);
  const candidates: { path: string; score: number; sample: string }[] = [];

  // For performance, limit how many files we sample (configurable by topK * factor)
  const maxToSample = Math.min(allFiles.length, Math.max(conf.topK * 6, 200));
  for (let i = 0; i < Math.min(allFiles.length, maxToSample); i++) {
    const rel = allFiles[i];
    try {
      const res = await api.getRepoFile(rel);
      const content = (res && typeof res.content === "string") ? res.content : "";
      const sample = content.slice(0, sampleBytes);
      const score = lexicalScore(promptWords, rel, sample);
      if (score > 0) candidates.push({ path: rel, score, sample });
    } catch {
      // skip unreadable files
    }
  }

  // Boost preferred paths
  if (conf.preferPaths && conf.preferPaths.length > 0) {
    for (const c of candidates) {
      for (const p of conf.preferPaths) {
        if (c.path.startsWith(p)) c.score *= 1.5;
      }
    }
  }

  // Sort by score desc
  candidates.sort((a, b) => b.score - a.score);

  const files: ContextFile[] = [];
  let totalTokens = 0;
  for (const c of candidates) {
    if (files.length >= conf.topK) break;
    if (totalTokens >= conf.tokenBudget) break;
    if (c.score < (conf.minScore ?? 0.1)) break;

    try {
      const res = await api.getRepoFile(c.path);
      const content = (res && typeof res.content === "string") ? res.content : "";
      const size = content.length;
      const summary = heuristicSummary(content);
      const snippet = extractSnippet(content);
      let tokensEstimate = estimateTokensFromChars(content.length);
      if (totalTokens + tokensEstimate > conf.tokenBudget) {
        // truncate content to fit remaining budget
        const remaining = Math.max(0, conf.tokenBudget - totalTokens);
        // approximate chars allowed
        const allowedChars = Math.floor(remaining * 4);
        const truncated = content.slice(0, allowedChars) + (content.length > allowedChars ? "\n...[truncated]" : "");
        const truncatedTokens = estimateTokensFromChars(truncated.length);
        files.push({ path: c.path, content: truncated, snippet: extractSnippet(truncated), summary, tokensEstimate: truncatedTokens, sizeBytes: size });
        totalTokens += truncatedTokens;
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

