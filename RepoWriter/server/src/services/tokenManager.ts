/**
 * tokenManager.ts
 *
 * Heuristic token estimation and small persistent usage store.
 *
 * NOTE: This uses a simple approximation of tokens := ceil(chars / 4).
 * Replace with a model-specific tokenizer (tiktoken or similar) for production accuracy.
 */

import fs from "fs/promises";
import path from "path";
import { REPO_PATH } from "../config.js";

const STORE_REL = ".repowriter/token_usage.json";

/** Rough heuristic: characters / 4 => tokens */
export function estimateTokensFromText(text: string | null | undefined): number {
  if (!text) return 0;
  // treat CRLF as single char
  const chars = String(text).length;
  return Math.max(1, Math.ceil(chars / 4));
}

/** Slightly more conservative heuristic allowing a small overhead. */
export function estimateTokensWithMargin(text: string | null | undefined, marginPercent = 0.1): number {
  const base = estimateTokensFromText(text);
  return Math.ceil(base * (1 + Math.max(0, marginPercent)));
}

/** Truncate a string to approximately maxTokens tokens (heuristic). */
export function truncateTextToTokens(text: string, maxTokens: number): string {
  if (!text) return "";
  const charsAllowed = Math.floor(maxTokens * 4);
  if (text.length <= charsAllowed) return text;
  // Try to cut at a newline boundary within last few characters to preserve structure
  const slice = text.slice(0, charsAllowed);
  const lastNewline = slice.lastIndexOf("\n");
  if (lastNewline > Math.floor(charsAllowed * 0.5)) {
    return slice.slice(0, lastNewline) + "\n...[truncated]";
  }
  return slice + "\n...[truncated]";
}

/**
 * Split text into chunks that are each approximately <= maxTokens tokens.
 * Returns array of strings.
 */
export function splitTextByTokens(text: string, maxTokens: number, overlapTokens = 0): string[] {
  if (!text) return [];
  if (maxTokens <= 0) throw new Error("maxTokens must be > 0");
  const maxChars = Math.floor(maxTokens * 4);
  const overlapChars = Math.floor(overlapTokens * 4);

  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + maxChars);
    // try to end on newline for neatness
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > i + Math.floor(maxChars * 0.33)) {
        end = nl;
      }
    }
    const chunk = text.slice(i, end);
    out.push(chunk);
    i = end;
    if (overlapChars > 0) {
      i = Math.max(0, i - overlapChars);
    }
  }
  return out;
}

/**
 * Given an array of items { path, content, tokensEstimate } trim/truncate them so that
 * total tokens <= tokenBudget. Returns a new array copy with possibly truncated content
 * and updated tokensEstimate, in the same order.
 */
export function ensureItemsWithinTokenBudget<T extends { content?: string; tokensEstimate?: number }>(
  items: T[],
  tokenBudget: number
): { items: T[]; totalTokens: number } {
  const out: T[] = [];
  let total = 0;
  for (const item of items) {
    if (total >= tokenBudget) break;
    const content = item.content || "";
    let est = typeof item.tokensEstimate === "number" ? item.tokensEstimate : estimateTokensFromText(content);

    if (total + est <= tokenBudget) {
      out.push(Object.assign({}, item));
      total += est;
    } else {
      const remaining = Math.max(0, tokenBudget - total);
      if (remaining <= 0) break;
      const truncated = truncateTextToTokens(content, remaining);
      const newEst = estimateTokensFromText(truncated);
      const clone: any = Object.assign({}, item);
      clone.content = truncated;
      clone.tokensEstimate = newEst;
      out.push(clone);
      total += newEst;
      break;
    }
  }
  return { items: out, totalTokens: total };
}

/** Persistent token usage store (very small) */
class TokenUsageStore {
  private path: string;
  private cache: Record<string, number> | null = null;
  private dirty = false;

  constructor() {
    this.path = path.join(REPO_PATH, STORE_REL);
  }

  private async load() {
    if (this.cache !== null) return;
    try {
      const raw = await fs.readFile(this.path, "utf8");
      this.cache = JSON.parse(raw) as Record<string, number>;
    } catch {
      this.cache = {};
    }
  }

  private async save() {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.cache || {}, null, 2), "utf8");
      await fs.rename(tmp, this.path);
      this.dirty = false;
    } catch {
      // swallow
    }
  }

  /** Get usage for a key (e.g., conversation id) */
  async get(key: string): Promise<number> {
    await this.load();
    return this.cache?.[key] ?? 0;
  }

  /** Increment usage for a key by amount (returns new value) */
  async inc(key: string, by = 0): Promise<number> {
    await this.load();
    const cur = this.cache?.[key] ?? 0;
    const next = cur + by;
    if (!this.cache) this.cache = {};
    this.cache[key] = next;
    this.dirty = true;
    // async save (do not await)
    this.save().catch(() => {});
    return next;
  }

  /** Reset usage for a key */
  async reset(key: string): Promise<void> {
    await this.load();
    if (!this.cache) this.cache = {};
    delete this.cache[key];
    this.dirty = true;
    this.save().catch(() => {});
  }

  /** Dump whole store (for diagnostics) */
  async dumpAll(): Promise<Record<string, number>> {
    await this.load();
    return Object.assign({}, this.cache || {});
  }
}

export const tokenUsageStore = new TokenUsageStore();

export default {
  estimateTokensFromText,
  estimateTokensWithMargin,
  truncateTextToTokens,
  splitTextByTokens,
  ensureItemsWithinTokenBudget,
  tokenUsageStore
};

