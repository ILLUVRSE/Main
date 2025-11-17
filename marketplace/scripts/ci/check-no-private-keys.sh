#!/usr/bin/env bash
# marketplace/scripts/ci/check-no-private-keys.sh
#
# CI helper: fail if private keys or obvious secret artifacts are present in tracked files.
# Checks:
#  - PEM private key headers (RSA/ENCRYPTED/EC/OPENSSH)
#  - Private key env var patterns (PRIVATE_KEY=, AWS_SECRET_ACCESS_KEY=, SECRET=)
#  - Tracked files with .key/.pem/.p12 extensions that contain private markers
#
# Excludes: node_modules, dist, .git and you can customize exceptions with GIT_GREP_EXCLUDE.
#
# To bypass locally (not recommended), set ALLOW_PRIVATE_KEYS=1 in your environment.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.."; pwd)"
cd "$ROOT_DIR"

if [ "${ALLOW_PRIVATE_KEYS:-0}" != "0" ]; then
  echo "[check-no-private-keys] ALLOW_PRIVATE_KEYS is set; skipping checks."
  exit 0
fi

# Exclude patterns for git-grep (colon-separated pathspecs)
# Use git pathspec :!pattern to exclude; we'll exclude common build and data directories
EXCLUDES=(
  ':!node_modules'
  ':!dist'
  ':!.git'
  ':!marketplace/.minio-data'
  # allow signerMock and other dev-only files that output public keys, but we'll still scan files' contents
)

# Convert to args
EXCLUDE_ARGS=()
for e in "${EXCLUDES[@]}"; do
  EXCLUDE_ARGS+=("$e")
done

# Patterns to search for (regex)
PRIVATE_KEY_HEADERS='-----BEGIN (ENCRYPTED )?PRIVATE KEY-----|-----BEGIN RSA PRIVATE KEY-----|-----BEGIN EC PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----|-----BEGIN ENCRYPTED PRIVATE KEY-----'
SECRET_ENV_PATTERNS='(^|\W)(AWS_SECRET_ACCESS_KEY|AWS_SECRET|SECRET_KEY|PRIVATE_KEY|DB_PASSWORD|S3_SECRET|S3_SECRET_ACCESS_KEY|PAYMENT_PROVIDER_.*SECRET)($|\W|=)'
# Look for files with key/pem/p12 extensions tracked by git
EXT_GLOBS=('*.pem' '*.key' '*.p12' '*.pfx')

FAILED=0

echo "[check-no-private-keys] Scanning tracked files for private key headers..."
# Search for PEM private key headers in tracked files
# Use git grep to only search tracked files and respect excludes
set +e
PEM_MATCHES=$(git grep -n -I -E "$PRIVATE_KEY_HEADERS" -- "${EXCLUDE_ARGS[@]}" 2>/dev/null || true)
set -e

if [ -n "$PEM_MATCHES" ]; then
  echo "ERROR: Found potential PEM private key headers in tracked files:"
  echo "$PEM_MATCHES" | sed 's/^/  /'
  FAILED=1
fi

echo "[check-no-private-keys] Scanning tracked files for common secret environment variable patterns..."
set +e
SECRET_MATCHES=$(git grep -n -I -E "$SECRET_ENV_PATTERNS" -- "${EXCLUDE_ARGS[@]}" 2>/dev/null || true)
set -e

if [ -n "$SECRET_MATCHES" ]; then
  echo "ERROR: Found probable secret environment variable assignments in tracked files:"
  echo "$SECRET_MATCHES" | sed 's/^/  /'
  FAILED=1
fi

# Inspect tracked files with extensions for private key markers (in case git grep missed due to binary or other)
echo "[check-no-private-keys] Inspecting tracked .pem/.key/.p12/.pfx files for private markers..."
for glob in "${EXT_GLOBS[@]}"; do
  # List tracked files matching the glob
  mapfile -t files < <(git ls-files "$glob" 2>/dev/null || true)
  for f in "${files[@]}"; do
    # Skip obvious exceptions (public keys or readme-like), detect private key headers inside file
    if grep -Iq . "$f"; then
      if grep -n -E "$PRIVATE_KEY_HEADERS" "$f" >/dev/null 2>&1; then
        echo "ERROR: Tracked key-like file contains private key header: $f"
        grep -n -E "$PRIVATE_KEY_HEADERS" "$f" | sed 's/^/  /'
        FAILED=1
      fi
    else
      # binary file - inspect for small strings (search for 'PRIVATE KEY' text)
      if strings "$f" 2>/dev/null | grep -E "PRIVATE KEY" >/dev/null 2>&1; then
        echo "ERROR: Tracked binary file may contain private key material: $f"
        FAILED=1
      fi
    fi
  done
done

# Optional check: accidentally committed .env or .env.* files containing secrets
echo "[check-no-private-keys] Checking for tracked .env files containing secret-looking keys..."
set +e
ENV_MATCHES=$(git ls-files -- '*.env' '*.env.*' 2>/dev/null | xargs -r grep -n -I -E "$SECRET_ENV_PATTERNS" 2>/dev/null || true)
set -e

if [ -n "$ENV_MATCHES" ]; then
  echo "ERROR: Found environment files with secret-like variables:"
  echo "$ENV_MATCHES" | sed 's/^/  /'
  FAILED=1
fi

# Finalize
if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "================================================================"
  echo "POSSIBLE PRIVATE KEYS / SECRETS FOUND. Remove sensitive material"
  echo "from the repository and place secrets into Vault/Secret Manager."
  echo "If this is a false positive, update the check script to explicitly"
  echo "allow the safe path and ensure the check is reviewed."
  echo "================================================================"
  exit 2
fi

echo "[check-no-private-keys] No obvious private key material or secret env vars found in tracked files."
exit 0

