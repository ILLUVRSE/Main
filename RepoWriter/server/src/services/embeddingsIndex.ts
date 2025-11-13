/**
 * embeddingsIndex.ts
 *
 * Simple file-backed embeddings index for RepoWriter.
 *
 * - If OPENAI_API_URL / OPENAI_API_KEY are configured, it will call the embeddings endpoint.
 * - If embeddings endpoint is not available (or fails), the module gracefully falls back to
 *   a lexical scoring fallback (so users without embeddings still get functionality).
 *
 * Changes:
 * - Persist the index outside the repository when REPOWRITER_DATA_DIR is set.
 * - Skip sensitive files (env, keys, secret dirs, production configs).
 * - Keep existing truncation behavior for samples.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import fetch from "node-fetch"; // If node has global fetch, bundlers may ignore; include for compatibility.
import { REPO_PATH, getOpenAIHeaders } from "../config.js";

type IndexItem = {
  path: string;
  vector: number[] | null;
  textSample: string; // text used to compute vector (truncated)
};

type IndexFile = {
  updatedAt: string;
  model: string | null;
  items: IndexItem[];
};

const INDEX_REL_PATH = ".repowriter/embeddings_index.json";
const DEFAULT_MODEL = process.env.EMBEDDINGS_MODEL || "text-embedding-3-small";

/** Basic token/char heuristics */
function truncateTextForEmbedding(text: string, maxChars = 3000) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...[truncated]";
}

/** Compute cosine similarity */
function cosine(a: number[] = [], b: number[] = []) {
  if (a.length === 0 || b.length === 0) return 0;
  let adot = 0, anorm = 0, bnorm = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    adot += av * bv;
    anorm += av * av;
    bnorm += bv * bv;
  }
  if (anorm === 0 || bnorm === 0) return 0;
  return adot / (Math.sqrt(anorm) * Math.sqrt(bnorm));
}

/** Determine index file path using REPOWRITER_DATA_DIR when provided. */
async function indexFilePath() {
  const dataRootEnv = process.env.REPOWRITER_DATA_DIR || REPO_PATH;
  const dataRoot = path.isAbsolute(dataRootEnv) ? dataRootEnv : path.resolve(REPO_PATH, dataRootEnv);
  const idxPath = path.join(dataRoot, INDEX_REL_PATH);
  // Ensure directory exists when saving later; caller can create as needed.
  return idxPath;
}

/** Read index file (create default if missing) */
async function loadIndex(): Promise<IndexFile> {
  const idxPath = await indexFilePath();
  try {
    const raw = await fs.readFile(idxPath, "utf8");
    const parsed = JSON.parse(raw) as IndexFile;
    return parsed;
  } catch {
    return { updatedAt: new Date().toISOString(), model: null, items: [] };
  }
}

async function saveIndex(idx: IndexFile) {
  const idxPath = await indexFilePath();
  await fs.mkdir(path.dirname(idxPath), { recursive: true });
  await fs.writeFile(idxPath, JSON.stringify(idx, null, 2), "utf8");
}

/** Read a file safely with a max char size */
async function readFileSample(absPath: string, maxChars = 3000) {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return "";
    const fd = await fs.open(absPath, "r");
    try {
      const toRead = Math.min(stat.size, maxChars);
      const buf = Buffer.alloc(toRead);
      await fd.read(buf, 0, toRead, 0);
      let content = buf.toString("utf8");
      if (toRead < stat.size) content += "\n...[truncated]";
      return content;
    } finally {
      await fd.close();
    }
  } catch {
    return "";
  }
}

/** Decide whether a repo-relative path should be skipped for embeddings (secrets/configs). */
function isSensitiveRelPath(rel: string): boolean {
  const lower = rel.toLowerCase();

  // obvious secret files or keys
  if (/\.(env|pem|key|p12|jks|crt|csr)$/.test(lower)) return true;

  // dot env files
  if (path.basename(lower).startsWith(".env")) return true;

  // secrets directory or config production files
  if (lower.startsWith("secrets/") || lower.includes("/secrets/")) return true;
  if (lower === "config/production.yml" || lower.endsWith("/config/production.yml")) return true;

  // common config files that might contain secrets
  if (lower.includes("config/") && (lower.endsWith("credentials.json") || lower.endsWith("credentials.yml"))) return true;

  // node_modules, build artifacts, binary assets are not useful (already skipped by walk ignore)
  if (lower.startsWith("node_modules/") || lower.startsWith("dist/") || lower.startsWith("build/")) return true;

  return false;
}

/** Request embeddings from OpenAI-style endpoint. Returns vector or null on failure. */
async function requestEmbedding(text: string, model = DEFAULT_MODEL): Promise<number[] | null> {
  try {
    const headers = getOpenAIHeaders();
    const OPENAI_BASE = process.env.OPENAI_API_URL || "https://api.openai.com";
    const url = `${OPENAI_BASE}/v1/embeddings`;
    const body = { model, input: text };
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return null;
    }
    const j = await res.json();
    const vec = j?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) return null;
    return vec;
  } catch {
    return null;
  }
}

/** Build or rebuild the entire index (walk repo, compute embeddings). */
export async function buildIndex(options: { model?: string; maxFiles?: number; maxChars?: number } = {}) {
  const model = options.model || DEFAULT_MODEL;
  const maxFiles = options.maxFiles ?? 500;
  const maxChars = options.maxChars ?? 3000;

  // Collect files (simple walk, skip node_modules/.git)
  const collected: string[] = [];
  const ignore = new Set([".git", "node_modules", "dist", "build", "out", "coverage"]);

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
        if (ignore.has(name)) continue;
        await walk(full);
      } else if (ent.isFile()) {
        if (/\.(png|jpg|jpeg|gif|wasm)$/.test(name)) continue;
        // record repo-relative path
        const rel = path.relative(REPO_PATH, full).replace(/\\/g, "/");
        collected.push(rel);
      }
    }
  }
  await walk(REPO_PATH);

  const idx: IndexFile = { updatedAt: new Date().toISOString(), model, items: [] };
  let count = 0;
  for (const rel of collected) {
    if (count >= maxFiles) break;

    // Skip obvious sensitive files
    if (isSensitiveRelPath(rel)) continue;

    const abs = path.resolve(REPO_PATH, rel);
    const sample = await readFileSample(abs, maxChars);
    if (!sample) continue;

    // Use truncated sample
    const truncated = truncateTextForEmbedding(sample, maxChars);

    // Request embedding safely — if fails, fall back to lexical
    const vec = await requestEmbedding(truncated, model);
    idx.items.push({ path: rel, vector: vec, textSample: truncated });
    count++;
  }
  await saveIndex(idx);
  return idx;
}

/** Upsert single file: read sample, compute embedding and write to index. */
export async function upsertFile(relPath: string, options: { maxChars?: number; model?: string } = {}) {
  const model = options.model || DEFAULT_MODEL;
  const maxChars = options.maxChars ?? 3000;
  const abs = path.resolve(REPO_PATH, relPath);

  const relNormalized = path.relative(REPO_PATH, abs).replace(/\\/g, "/");
  if (isSensitiveRelPath(relNormalized)) throw new Error("Refuse to upsert sensitive file");

  const sample = await readFileSample(abs, maxChars);
  if (!sample) throw new Error("File not found or empty");
  const truncated = truncateTextForEmbedding(sample, maxChars);
  const vec = await requestEmbedding(truncated, model);
  const idx = await loadIndex();
  const found = idx.items.find(i => i.path === relNormalized);
  if (found) {
    found.vector = vec;
    found.textSample = truncated;
  } else {
    idx.items.push({ path: relNormalized, vector: vec, textSample: truncated });
  }
  idx.updatedAt = new Date().toISOString();
  idx.model = model;
  await saveIndex(idx);
  return { path: relNormalized, vector: vec };
}

/**
 * Query the index for topK matches for a given text.
 * If embeddings are available, uses cosine similarity on vectors.
 * If vectors are missing or embeddings call fails, falls back to lexical scoring on textSample.
 */
export async function queryEmbeddings(queryText: string, opts: { topK?: number } = {}) {
  const topK = opts.topK ?? 8;
  const idx = await loadIndex();
  const hasVectors = idx.items.some(i => Array.isArray(i.vector) && i.vector.length > 0);

  let queryVec: number[] | null = null;
  if (hasVectors) {
    queryVec = await requestEmbedding(truncateTextForEmbedding(queryText));
  }

  type Hit = { path: string; score: number; sample?: string };

  const hits: Hit[] = [];
  if (queryVec && hasVectors) {
    for (const it of idx.items) {
      if (!it.vector || it.vector.length === 0) continue;
      const s = cosine(queryVec, it.vector);
      hits.push({ path: it.path, score: s, sample: it.textSample });
    }
  } else {
    const qwords = Array.from(new Set(queryText.toLowerCase().split(/\W+/).filter(Boolean)));
    for (const it of idx.items) {
      const txt = (it.textSample || "").toLowerCase();
      let score = 0;
      for (const w of qwords) {
        if (txt.includes(w)) score += 1;
      }
      const name = it.path.toLowerCase();
      for (const w of qwords) {
        if (name.includes(w)) score += 1.5;
      }
      if (score > 0) hits.push({ path: it.path, score, sample: it.textSample });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

export default { buildIndex, upsertFile, queryEmbeddings };

