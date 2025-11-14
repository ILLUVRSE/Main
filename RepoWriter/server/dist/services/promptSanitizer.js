/**
 * promptSanitizer.ts
 *
 * Small server-side prompt sanitizer for RepoWriter.
 *
 * Usage:
 *   import { sanitizePrompt } from "./promptSanitizer.js";
 *   sanitizePrompt(prompt); // throws Error when prompt is disallowed
 *
 * Behavior:
 *  - Enforce a maximum prompt size (REPOWRITER_MAX_PROMPT_CHARS, default 30000)
 *  - Block a short list of dangerous patterns (shell download-and-run, eval, subprocess, rm -rf, ssh, docker run, apt/yum, sudo, etc.)
 *  - Block obvious API key leaks appearing in prompts (simple sk- pattern)
 *
 * This is intentionally conservative — the sanitizer throws on any match.
 */
const DEFAULT_MAX_CHARS = Number(process.env.REPOWRITER_MAX_PROMPT_CHARS || 30000);
const BLOCKED_SUBSTRINGS = [
    "eval(",
    "os.system",
    "subprocess",
    "rm -rf",
    "curl ",
    "wget ",
    "sudo ",
    "apt-get ",
    "yum ",
    "dnf ",
    "systemctl ",
    "service ",
    "docker run",
    "docker exec",
    "ssh ",
    "scp ",
    "nc ",
    "netcat ",
    "python -c",
    "bash -c",
    "chmod ",
    "chown ",
    "mkfs ",
    "dd ",
    "curl|bash",
    "curl .*\\| sh",
    "curl .*\\| bash",
    "pip install",
    "npm install -g",
    "curl -s",
    "curl -fs",
    "fetch(" // JS fetch that might be used to exfiltrate
];
// Some regex patterns for more complex detection (piped curl, keys, inline base64 -> exec)
const BLOCKED_REGEXES = [
    // detect piping a download into sh/bash
    /(curl|wget).*(\||%7C).*(sh|bash)/i,
    // detect "curl ... | bash" with optional flags
    /(curl|wget).*\|.*(bash|sh)/i,
    // detect obvious key-like strings (sk- prefix for OpenAI keys)
    /\bsk-[A-Za-z0-9\-_]{16,}\b/i,
    // detect "openai_api_key" style
    /openai[_-]?api[_-]?key/i,
    // detect base64 payloads then pipe to sh (very noisy but useful)
    /base64\s+\S+\s*\|\s*(sh|bash)/i
];
/** Estimate tokens loosely from chars (approx 4 chars/token). */
export function estimateTokensApprox(text) {
    return Math.max(1, Math.ceil((text?.length || 0) / 4));
}
/**
 * sanitizePrompt
 * Throws an Error when the prompt is disallowed.
 */
export function sanitizePrompt(prompt, opts) {
    if (typeof prompt !== "string")
        throw new Error("Prompt must be a string");
    const max = opts?.maxChars ?? DEFAULT_MAX_CHARS;
    if (prompt.length > max) {
        throw new Error(`Prompt too large: ${prompt.length} chars (max ${max})`);
    }
    const lower = prompt.toLowerCase();
    for (const sub of BLOCKED_SUBSTRINGS) {
        // If substring contains regex-like token (e.g., "curl|bash"), allow regex checks to handle it
        if (sub.includes("|") || sub.includes("\\") || sub.includes(".*"))
            continue;
        if (lower.includes(sub)) {
            throw new Error(`Prompt contains disallowed pattern: "${sub.trim()}"`);
        }
    }
    for (const rx of BLOCKED_REGEXES) {
        if (rx.test(prompt)) {
            throw new Error(`Prompt contains disallowed pattern: ${rx.toString()}`);
        }
    }
    // Extra check: disallow explicit requests to output credentials or secrets
    if (/\b(password|secret|api[-_ ]?key|private key|ssh[-_ ]?key)\b/i.test(prompt) && /(?:display|print|show|expose|reveal)/i.test(prompt)) {
        throw new Error("Prompt requests revealing secrets — disallowed");
    }
    // If we made it here, prompt is allowed
    return true;
}
export default { sanitizePrompt, estimateTokensApprox };
