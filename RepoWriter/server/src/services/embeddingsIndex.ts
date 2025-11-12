/**
 * embeddingsIndex.ts
 *
 * Simple file-backed embeddings index for RepoWriter.
 *
 * - If OPENAI_API_URL / OPENAI_API_KEY are configured, it will call the embeddings endpoint.
 * - If embeddings endpoint is not available (or fails), the module gracefully falls back to
 *   a lexical scoring fallback (so users without embeddings still get functionality).
 *
 * Index format:
 *   {
 *     updatedAt: "...",
 *     model: "text-embedding-xxx",
 *     items: [
 *       { path: "src/foo.ts", vector: [0.1, ...], textSample: "..." },
 *       ...
 *     ]
 *   }
 *
 * Exports:
 *   - buildIndex(options)
 *   - queryEmbeddings(text, { topK })
 *   - upsertFile(path)
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

/** Read index file (create default if missing) */
async function indexFilePath() {
  return path.join(REPO_PATH, INDEX_REL_PATH);
}

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

/** Request embeddings from OpenAI-style endpoint. Returns vector or null on failure. */
async function requestEmbedding(text: string, model = DEFAULT_MODEL): Promise<number[] | null> {
  // If no OPENAI_API_KEY and no OPENAI_API_URL, bail
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
      // If server returns non-OK (e.g., local mock), return null to enable lexical fallback
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
        collected.push(path.relative(REPO_PATH, full));
      }
    }
  }
  await walk(REPO_PATH);

  const idx: IndexFile = { updatedAt: new Date().toISOString(), model, items: [] };
  let count = 0;
  for (const rel of collected) {
    if (count >= maxFiles) break;
    const abs = path.resolve(REPO_PATH, rel);
    const sample = await readFileSample(abs, maxChars);
    if (!sample) continue;
    const truncated = truncateTextForEmbedding(sample, maxChars);
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
  const sample = await readFileSample(abs, maxChars);
  if (!sample) throw new Error("File not found or empty");
  const truncated = truncateTextForEmbedding(sample, maxChars);
  const vec = await requestEmbedding(truncated, model);
  const idx = await loadIndex();
  // replace or append
  const found = idx.items.find(i => i.path === relPath);
  if (found) {
    found.vector = vec;
    found.textSample = truncated;
  } else {
    idx.items.push({ path: relPath, vector: vec, textSample: truncated });
  }
  idx.updatedAt = new Date().toISOString();
  idx.model = model;
  await saveIndex(idx);
  return { path: relPath, vector: vec };
}

/**
 * Query the index for topK matches for a given text.
 * If embeddings are available, uses cosine similarity on vectors.
 * If vectors are missing or embeddings call fails, falls back to lexical scoring on textSample.
 */
export async function queryEmbeddings(queryText: string, opts: { topK?: number } = {}) {
  const topK = opts.topK ?? 8;
  const idx = await loadIndex();
  // If there are vectorized items, and we can compute query embedding, use it.
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
    // lexical fallback: simple substring + token overlap scoring
    const qwords = Array.from(new Set(queryText.toLowerCase().split(/\W+/).filter(Boolean)));
    for (const it of idx.items) {
      const txt = (it.textSample || "").toLowerCase();
      let score = 0;
      for (const w of qwords) {
        if (txt.includes(w)) score += 1;
      }
      // small boost for filename match
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

