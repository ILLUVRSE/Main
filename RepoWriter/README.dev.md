# RepoWriter — Local Development Guide

This document explains how to run, test, and develop RepoWriter locally. It assumes you have a working Node.js (>=16) environment and `git` installed.

> **Security note:** `RepoWriter/server/.env` must contain your OpenAI secrets and is **never** committed. If an API key is exposed, revoke it immediately from the OpenAI dashboard and replace it.

---

## Required environment variables

Create `RepoWriter/server/.env` (this file is gitignored). Minimal values:

```
OPENAI_API_KEY=sk-...
OPENAI_PROJECT_ID=proj_...    # optional for some OpenAI setups
REPO_PATH=/absolute/path/to/your/repo/root   # default: current working dir if unset
PORT=7071
GITHUB_REMOTE=origin
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=you@example.com
```

You can copy `RepoWriter/server/.env.example` and fill in values.

---

## Start dev servers

Start the backend:

```bash
npm --prefix RepoWriter/server run dev
```

Start the frontend:

```bash
npm --prefix RepoWriter/web run dev
```

To run both in background (example):

```bash
# from repo root
npm --prefix RepoWriter/server run dev > RepoWriter/server/server.log 2>&1 & \
pid1=$!; npm --prefix RepoWriter/web run dev > RepoWriter/web/web.log 2>&1 & pid2=$!; \
echo "server:$pid1 web:$pid2"
```

Check backend health:

```bash
curl -sS http://localhost:7071/api/health | jq .
# expected: {"ok":true}
```

---

## Basic API usage

### Plan (synchronous)

```bash
curl -sS -X POST http://localhost:7071/api/openai/plan \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Add a util/summarize.ts that summarizes top-level comments","memory":[]}' | jq .
```

### Stream (SSE)

```bash
curl -N -X POST http://localhost:7071/api/openai/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Add a util/summarize.ts that summarizes top-level comments","memory":[]}'
```

### Apply (dry-run)

```bash
curl -sS -X POST http://localhost:7071/api/openai/apply \
  -H "Content-Type: application/json" \
  -d '{"patches":[{"path":"hello.txt","content":"hi\n"}],"mode":"dry"}' | jq .
```

---

## Tests and type checks

Server unit tests (vitest):

```bash
npm --prefix RepoWriter/server run test
```

Type-check server:

```bash
npm --prefix RepoWriter/server exec -- tsc -p RepoWriter/server/tsconfig.json
```

Run repo-wide TypeScript check (may surface unrelated projects):

```bash
npm exec -- tsc --noEmit -p tsconfig.json
```

---

## Local mocks and CI

For deterministic CI and local tests, we provide an OpenAI mock at `RepoWriter/test/mocks/openaiMock.ts`. Tests can mount it or run it on a port and point `OPENAI_API_URL` (or override fetch) to the mock.

To run the mock standalone:

```bash
node RepoWriter/test/mocks/openaiMock.ts
# or: ts-node RepoWriter/test/mocks/openaiMock.ts
```

CI will use `openaiMock` so tests never call the real OpenAI.

---

## Patch workflow & safety

* The planner returns a **structured plan** with `steps` and `patches` (each patch is `{ path, content?, diff? }`).
* The UI and server support `dry` mode (validation only) and `apply` mode (write + commit locally).
* The `patcher` enforces path safety (no absolute paths, no traversal outside `REPO_PATH`).
* Commits are created locally with `repowriter:` message; server refuses to push by default.

If you need to roll back an apply, use the rollback metadata returned by `/api/openai/apply` (or call the `apply`/`rollback` path if implemented).

---

## Development tips

* Central config is at `RepoWriter/server/src/config.ts`. Keep secrets out of git.
* Use `RepoWriter/web/src/pages/CodeAssistant.tsx` as the main UI for experimenting the Codex flow.
* For streaming UI debugging, the PlanStream component and `codexWs` server will help you iterate quickly.
* Add unit tests for planner and patcher when you change prompts or parsing logic.

---

## Acceptance checklist (short)

1. Server accepts `OPENAI_API_KEY` and refuses to start if missing.
2. `POST /api/openai/plan` returns structured JSON plan.
3. Streaming (`/api/openai/stream` or websocket) shows incremental plan fragments.
4. Patch preview and dry-run work and do not modify disk.
5. Apply commits with `repowriter:` and returns rollback metadata.
6. Unit tests for core services pass; CI uses openaiMock.

---

## Troubleshooting

* **Missing types / TS errors**: run `npm --prefix RepoWriter/server exec -- tsc -p RepoWriter/server/tsconfig.json` and fix the files listed.
* **OpenAI auth issues**: confirm `OPENAI_API_KEY` in `RepoWriter/server/.env`; inspect server startup logs (they print key prefix only).
* **Permissions**: repo operations (git, write) use `REPO_PATH`; ensure the process has permissions to modify files there.
# RepoWriter — Local Development Guide

This document explains how to run, test, and develop RepoWriter locally. It assumes you have a working Node.js (>=16) environment and `git` installed.

> **Security note:** `RepoWriter/server/.env` must contain your OpenAI secrets and is **never** committed. If an API key is exposed, revoke it immediately from the OpenAI dashboard and replace it.

---

## Required environment variables

Create `RepoWriter/server/.env` (this file is gitignored). Minimal values:

```
OPENAI_API_KEY=sk-...
OPENAI_PROJECT_ID=proj_...    # optional for some OpenAI setups
REPO_PATH=/absolute/path/to/your/repo/root   # default: current working dir if unset
PORT=7071
GITHUB_REMOTE=origin
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=you@example.com
```

You can copy `RepoWriter/server/.env.example` and fill in values.

---

## Start dev servers

Start the backend:

```bash
npm --prefix RepoWriter/server run dev
```

Start the frontend:

```bash
npm --prefix RepoWriter/web run dev
```

To run both in background (example):

```bash
# from repo root
npm --prefix RepoWriter/server run dev > RepoWriter/server/server.log 2>&1 & \
pid1=$!; npm --prefix RepoWriter/web run dev > RepoWriter/web/web.log 2>&1 & pid2=$!; \
echo "server:$pid1 web:$pid2"
```

Check backend health:

```bash
curl -sS http://localhost:7071/api/health | jq .
# expected: {"ok":true}
```

---

## Basic API usage

### Plan (synchronous)

```bash
curl -sS -X POST http://localhost:7071/api/openai/plan \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Add a util/summarize.ts that summarizes top-level comments","memory":[]}' | jq .
```

### Stream (SSE)

```bash
curl -N -X POST http://localhost:7071/api/openai/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Add a util/summarize.ts that summarizes top-level comments","memory":[]}'
```

### Apply (dry-run)

```bash
curl -sS -X POST http://localhost:7071/api/openai/apply \
  -H "Content-Type: application/json" \
  -d '{"patches":[{"path":"hello.txt","content":"hi\n"}],"mode":"dry"}' | jq .
```

---

## Tests and type checks

Server unit tests (vitest):

```bash
npm --prefix RepoWriter/server run test
```

Type-check server:

```bash
npm --prefix RepoWriter/server exec -- tsc -p RepoWriter/server/tsconfig.json
```

Run repo-wide TypeScript check (may surface unrelated projects):

```bash
npm exec -- tsc --noEmit -p tsconfig.json
```

---

## Local mocks and CI

For deterministic CI and local tests, we provide an OpenAI mock at `RepoWriter/test/mocks/openaiMock.ts`. Tests can mount it or run it on a port and point `OPENAI_API_URL` (or override fetch) to the mock.

To run the mock standalone:

```bash
node RepoWriter/test/mocks/openaiMock.ts
# or: ts-node RepoWriter/test/mocks/openaiMock.ts
```

CI will use `openaiMock` so tests never call the real OpenAI.

---

## Patch workflow & safety

* The planner returns a **structured plan** with `steps` and `patches` (each patch is `{ path, content?, diff? }`).
* The UI and server support `dry` mode (validation only) and `apply` mode (write + commit locally).
* The `patcher` enforces path safety (no absolute paths, no traversal outside `REPO_PATH`).
* Commits are created locally with `repowriter:` message; server refuses to push by default.

If you need to roll back an apply, use the rollback metadata returned by `/api/openai/apply` (or call the `apply`/`rollback` path if implemented).

---

## Development tips

* Central config is at `RepoWriter/server/src/config.ts`. Keep secrets out of git.
* Use `RepoWriter/web/src/pages/CodeAssistant.tsx` as the main UI for experimenting the Codex flow.
* For streaming UI debugging, the PlanStream component and `codexWs` server will help you iterate quickly.
* Add unit tests for planner and patcher when you change prompts or parsing logic.

---

## Acceptance checklist (short)

1. Server accepts `OPENAI_API_KEY` and refuses to start if missing.
2. `POST /api/openai/plan` returns structured JSON plan.
3. Streaming (`/api/openai/stream` or websocket) shows incremental plan fragments.
4. Patch preview and dry-run work and do not modify disk.
5. Apply commits with `repowriter:` and returns rollback metadata.
6. Unit tests for core services pass; CI uses openaiMock.

---

## Troubleshooting

* **Missing types / TS errors**: run `npm --prefix RepoWriter/server exec -- tsc -p RepoWriter/server/tsconfig.json` and fix the files listed.
* **OpenAI auth issues**: confirm `OPENAI_API_KEY` in `RepoWriter/server/.env`; inspect server startup logs (they print key prefix only).
* **Permissions**: repo operations (git, write) use `REPO_PATH`; ensure the process has permissions to modify files there.

