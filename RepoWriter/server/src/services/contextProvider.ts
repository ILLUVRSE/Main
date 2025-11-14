/**
 * contextProvider.ts
 *
 * Build a token-bounded repo context payload for the planner.
 *
 * Strategy:
 * - Walk repo files (skipping node_modules, .git, build dirs).
 * - Score files by simple lexical match of prompt words in filename/content.
 * - Read top-scoring files (up to maxFileBytes) and produce:
 *     { path, content (truncated), snippet, summary, tokensEstimate }
 * - Return files until token budget
 *
 * Promotion & allocation flows:
 * Promotion events are written to Reasoning Graph and Audit Bus;
 * Resource Allocator interacts with Kernel and Finance for compute/capital assignments.
 */