import "dotenv/config";

/**
 * Central configuration for RepoWriter server.
 *
 * NOTE: We intentionally do not throw if OPENAI_API_KEY is missing here because
 * middleware (ensureOpenAIKey) enforces presence/allowance rules (e.g., sandbox or local mock).
 * This module simply gathers config values for other modules to use.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID || "";

export const REPO_PATH = process.env.REPO_PATH || process.cwd();
export const PORT = Number(process.env.PORT || 7071);
export const GITHUB_REMOTE = process.env.GITHUB_REMOTE || "origin";
export const GIT_USER_NAME = process.env.GIT_USER_NAME || "illuvrse-bot";
export const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || "noreply@illuvrse";

// Sandbox configuration for validation runner
export const SANDBOX_ENABLED = process.env.SANDBOX_ENABLED === "1";
export const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || ""; // optional docker image or identifier for sandbox
export const SANDBOX_COMMAND = process.env.SANDBOX_COMMAND || ""; // optional custom command to run sandbox
export const SANDBOX_TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS || 60000);
export const SANDBOX_ALLOWED_ROLES: string[] = (process.env.SANDBOX_ALLOWED_ROLES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Local LLM
export const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || "";

// GitHub / push config
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
export const GITHUB_REPO = process.env.GITHUB_REPO || ""; // optional override for owner/repo (owner/repo)

// Telemetry / logging toggles (optional)
export const LOG_FORMAT = process.env.LOG_FORMAT || "dev";

// OpenAI headers helper
export function getOpenAIHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (OPENAI_API_KEY) {
    headers["Authorization"] = `Bearer ${OPENAI_API_KEY}`;
  }
  if (OPENAI_PROJECT_ID) {
    headers["OpenAI-Project"] = OPENAI_PROJECT_ID;
  }
  return headers;
}

// Diagnostic hint when sandbox enabled but no runner configured
if (SANDBOX_ENABLED && !SANDBOX_IMAGE && !SANDBOX_COMMAND) {
  try {
    console.warn(
      "[config] SANDBOX_ENABLED=1 but SANDBOX_IMAGE and SANDBOX_COMMAND are not set. " +
        "The host-based sandbox will be used. For production consider configuring SANDBOX_IMAGE or SANDBOX_COMMAND."
    );
  } catch {}
}

export default {
  OPENAI_API_KEY,
  OPENAI_PROJECT_ID,
  getOpenAIHeaders,
  REPO_PATH,
  PORT,
  GITHUB_REMOTE,
  GIT_USER_NAME,
  GIT_USER_EMAIL,
  SANDBOX_ENABLED,
  SANDBOX_IMAGE,
  SANDBOX_COMMAND,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_ALLOWED_ROLES,
  LOCAL_LLM_URL,
  GITHUB_TOKEN,
  GITHUB_REPO,
  LOG_FORMAT
};

