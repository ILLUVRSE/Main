#!/usr/bin/env bash

set -euo pipefail

echo "[secrets_check] scanning repository for high-risk secrets"

fail=0

if git grep -n --color=never -E 'AKIA[0-9A-Z]{16}' -- $(git ls-files) >/tmp/aws_keys 2>/dev/null; then
  echo "Potential AWS access keys detected:" >&2
  cat /tmp/aws_keys >&2
  fail=1
fi

if git grep -n --color=never -E '-----BEGIN (RSA|EC|DSA)? ?PRIVATE KEY-----' -- $(git ls-files) >/tmp/private_keys 2>/dev/null; then
  echo "Private key material detected:" >&2
  cat /tmp/private_keys >&2
  fail=1
fi

if git grep -n --color=never -E 'SECRET(_KEY)?\s*=\s*[^\s]+' -- $(git ls-files) >/tmp/secret_assignments 2>/dev/null; then
  echo "Hard-coded secrets detected:" >&2
  cat /tmp/secret_assignments >&2
  fail=1
fi

if [[ $fail -ne 0 ]]; then
  echo "[secrets_check] potential secrets found" >&2
  exit 1
fi

echo "[secrets_check] no high-risk secrets detected"

