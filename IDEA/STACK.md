# Codex Local (Web App) — Stack & Defaults
Runtime: Node.js (LTS) + pnpm (default)  [can CHANGE to Bun later]
Backend: TypeScript + Express (local HTTP) 
Frontend: React + Vite (TypeScript)
DB/State: SQLite (better-sqlite3), local path: ./data/codex.db
LLM Runner: Ollama at http://127.0.0.1:11434 (model: qwen2.5-coder:7b; can swap)
Git Integration: git + gh CLI (preferred)
Profiles:
  - ILLUVRSE (strict): profiles/illuvrse/.env
  - Personal (relaxed): profiles/personal/.env
Security: Never paste secrets into chat; keep creds in local .env files only.
