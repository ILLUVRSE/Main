#!/usr/bin/env bash
# scripts/ci/check-no-private-keys.sh
# Fails CI when PEM-formatted private keys are committed outside of approved sample docs.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

ALLOWLIST_CONTENT_REGEX='^(kernel/env\.sample|agent-manager/deployment\.md)$'
ALLOWLIST_FILE_REGEX='^(kernel/test/fixtures/certs/.*|docs/examples/mtls/.+\.key)$'
ALLOWLIST_ENV_REGEX='^(RepoWriter/server/.env|RepoWriter/web/.env|sentinelnet/.env)$'

violations=0

check_pem_blocks() {
  local matches
  matches=$(git grep -n --color=never -E -- '-----BEGIN (RSA|EC|DSA|OPENSSH)? ?PRIVATE KEY-----' || true)
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local file="${line%%:*}"
    if [[ "$file" =~ $ALLOWLIST_CONTENT_REGEX ]]; then
      continue
    fi
    if [[ $violations -eq 0 ]]; then
      echo "[no-private-keys] FATAL: potential private key material committed:"
    fi
    echo "  $line"
    violations=$((violations + 1))
  done <<< "$matches"
}

check_sensitive_files() {
  local files
  files=$(git ls-files '*.pem' '*.key' 2>/dev/null || true)
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if [[ "$file" =~ $ALLOWLIST_FILE_REGEX ]]; then
      continue
    fi
    echo "[no-private-keys] FATAL: file path looks like PEM/KEY material: $file"
    violations=$((violations + 1))
  done <<< "$files"
}

check_env_files() {
  local env_files
  env_files=$(git ls-files '*.env' ':!:*.env.example' ':!:*.env.sample' ':!:*.env.dist' 2>/dev/null || true)
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if [[ "$file" =~ $ALLOWLIST_ENV_REGEX ]]; then
      continue
    fi
    if grep -qE '^[A-Za-z_][A-Za-z0-9_]*=\S+' "$file"; then
      echo "[no-private-keys] FATAL: tracked .env file contains assignments: $file"
      violations=$((violations + 1))
    fi
  done <<< "$env_files"
}

check_pem_blocks
check_sensitive_files
check_env_files

if [[ $violations -gt 0 ]]; then
  cat <<'EOF'

Tracked secrets or private key artifacts detected. Remove the offending files,
or convert them to sanitized *.env.example / sample files before committing.
EOF
  exit 1
fi

echo "[no-private-keys] PASS: no private keys or secret .env files detected."
