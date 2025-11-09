#!/usr/bin/env sh
set -e

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "Enabling pnpm via corepack..."
    corepack enable pnpm
  else
    echo "Installing pnpm globally via npm..."
    npm install -g pnpm
  fi
fi

echo "Installing workspace dependencies..."
pnpm install

echo "Ensuring server dependencies..."
pnpm --filter codex-server install

echo "Ensuring web dependencies..."
pnpm --filter codex-web install

echo "Building server..."
pnpm --filter codex-server build

echo "\nSetup complete. Next steps:"
cat <<'CHECKLIST'
1. pnpm --filter codex-server dev
2. pnpm --filter codex-web dev
3. pnpm --filter codex-server test
4. curl http://127.0.0.1:5175/health
CHECKLIST
