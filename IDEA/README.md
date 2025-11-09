# IDEA (ILLUVRSE)

IDEA (ILLUVRSE) is a local-first developer cockpit pairing a lightweight Express backend with a Vite + React frontend. It wraps a local Ollama model for ideation, stores idea history on disk, and offers ergonomic git helpers so you can experiment safely in your repository.

## Packages

This repository is managed by pnpm workspaces:

- `server/` — Express + TypeScript API talking to Ollama and git
- `web/` — Vite + React chat interface for IDEA

## Getting started

Run the setup script to install pnpm, workspace dependencies, and build the server:

```bash
./scripts/setup_local.sh
```

Then launch both apps in separate terminals:

```bash
pnpm --filter codex-server dev
pnpm --filter codex-web dev
```

The web UI will default to `http://127.0.0.1:5173` and the API listens on `http://127.0.0.1:5175`.

See `server/README.md` for environment variables, API examples, and git safety notes.
