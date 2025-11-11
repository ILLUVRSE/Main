import "dotenv/config";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID;

export const REPO_PATH = process.env.REPO_PATH || process.cwd();
export const PORT = Number(process.env.PORT || 7071);
export const GITHUB_REMOTE = process.env.GITHUB_REMOTE || "origin";
export const GIT_USER_NAME = process.env.GIT_USER_NAME || "illuvrse-bot";
export const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || "noreply@illuvrse";

if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in environment; set it in RepoWriter/server/.env or your shell.");
}

export function getOpenAIHeaders(): Record<string,string> {
  const headers: Record<string,string> = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  };
  if (OPENAI_PROJECT_ID) {
    headers["OpenAI-Project"] = OPENAI_PROJECT_ID;
  }
  return headers;
}

export default {
  OPENAI_API_KEY,
  OPENAI_PROJECT_ID,
  getOpenAIHeaders,
  REPO_PATH,
  PORT,
  GITHUB_REMOTE,
  GIT_USER_NAME,
  GIT_USER_EMAIL
};

