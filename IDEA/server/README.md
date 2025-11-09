# IDEA (ILLUVRSE) Local Server

This Express server powers the IDEA (ILLUVRSE) local developer experience. It exposes chat, idea management, and git utilities while proxying large language model requests to a local Ollama instance.

> **Security note:** this service is meant for localhost development only. Do **not** expose it to the public internet or run it on shared machines.

## Requirements

- Node.js 18 or newer (Node 20 recommended)
- pnpm (installed automatically by the setup script) or npm
- [Ollama](https://ollama.com/) running locally with the desired model pulled

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5175` | HTTP port to bind |
| `OLLAMA_API_URL` | `http://127.0.0.1:11434` | Base URL of the local Ollama instance |
| `OLLAMA_MODEL` | `llama2` | Model name passed to Ollama |
| `GIT_ALLOW_PUSH` | _(unset)_ | When set to `true`, `/git/commit` requests with `push: true` will perform `git push`. Otherwise push requests fail with `GIT_ALLOW_PUSH not set`. |

## Installation

```bash
pnpm install
pnpm --filter codex-server install
```

## Development

```bash
pnpm --filter codex-server dev
```

The server listens on `http://127.0.0.1:5175` by default. Update `PORT` if you need another port.

## Production build

```bash
pnpm --filter codex-server build
pnpm --filter codex-server start
```

## Tests

```bash
pnpm --filter codex-server test
```

Tests use `vitest` and `supertest`. External dependencies such as Ollama and git operations are mocked so the suite is deterministic.

## API quick checks

All responses are JSON with `{ ok: boolean, ... }` envelopes.

```bash
# health check
curl http://127.0.0.1:5175/health

# chat (requires local Ollama)
curl -X POST http://127.0.0.1:5175/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello IDEA!"}]}'

# create an idea
curl -X POST http://127.0.0.1:5175/api/v1/idea \
  -H 'Content-Type: application/json' \
  -d '{"title":"New feature","description":"Add cooperative quests."}'

# list ideas
curl http://127.0.0.1:5175/api/v1/idea

# generate suggestion (replace IDEA_ID)
curl -X POST http://127.0.0.1:5175/api/v1/idea/IDEA_ID/generate

# git status
curl http://127.0.0.1:5175/git/status
```

If Ollama is not running, `/chat` and `/api/v1/idea/:id/generate` return friendly error messages pointing back to this README.

## Docker

Build the production image:

```bash
docker build -t idea-server .
```

Run it locally (Ollama must be accessible from the container):

```bash
docker run --rm -p 5175:5175 \
  -e OLLAMA_API_URL=http://host.docker.internal:11434 \
  idea-server
```

## Git safety

The `/git/commit` endpoint stages all changes with `git add -A` before committing. Passing `{ "push": true }` in the request body only works when `GIT_ALLOW_PUSH=true` is present in the environment. Otherwise the server responds with `{ ok: false, error: "GIT_ALLOW_PUSH not set" }` and no push occurs.
