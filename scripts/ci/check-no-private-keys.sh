#!/usr/bin/env bash
# scripts/ci/check-no-private-keys.sh
# Fails CI when PEM-formatted private keys are committed outside of approved sample docs.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

ALLOWLIST_REGEX='^(kernel/env\.sample|agent-manager/deployment\.md)$'

matches=$(git grep -n --color=never -E -- '-----BEGIN (RSA|EC|DSA|OPENSSH)? ?PRIVATE KEY-----' || true)

if [[ -z "${matches}" ]]; then
  echo "[no-private-keys] OK: no PEM private keys detected."
  exit 0
fi

violations=0
while IFS= read -r line; do
  file="${line%%:*}"
  if [[ "$file" =~ $ALLOWLIST_REGEX ]]; then
    continue
  fi
  if [[ $violations -eq 0 ]]; then
    echo "[no-private-keys] FATAL: potential private key material committed:"
  fi
  echo "  $line"
  violations=$((violations + 1))
done <<< "$matches"

if [[ $violations -gt 0 ]]; then
  cat <<'EOF'

Private key PEM blocks must never live in the repository. Remove the sensitive file(s),
store them in KMS/HSM or secret storage, and reference them via environment variables.
If this is a documented sample, add the file to the ALLOWLIST_REGEX in scripts/ci/check-no-private-keys.sh.
EOF
  exit 1
fi

echo "[no-private-keys] Only allowlisted sample references found."
