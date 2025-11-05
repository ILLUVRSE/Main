#!/usr/bin/env bash
set -euo pipefail

OUT=${1:-/tmp/illuvrse-certs}
mkdir -p "$OUT"

# Expect base64-encoded certs in env
: "${CI_KERNEL_CA:?CI_KERNEL_CA required}"
: "${CI_KERNEL_SERVER_CERT:?CI_KERNEL_SERVER_CERT required}"
: "${CI_KERNEL_SERVER_KEY:?CI_KERNEL_SERVER_KEY required}"
: "${CI_KERNEL_CLIENT_CERT:?CI_KERNEL_CLIENT_CERT required}"
: "${CI_KERNEL_CLIENT_KEY:?CI_KERNEL_CLIENT_KEY required}"

echo "$CI_KERNEL_CA" | base64 --decode > "$OUT/kernel-ca.crt"
echo "$CI_KERNEL_SERVER_CERT" | base64 --decode > "$OUT/kernel-server.crt"
echo "$CI_KERNEL_SERVER_KEY" | base64 --decode > "$OUT/kernel-server.key"
echo "$CI_KERNEL_CLIENT_CERT" | base64 --decode > "$OUT/kernel-client.crt"
echo "$CI_KERNEL_CLIENT_KEY" | base64 --decode > "$OUT/kernel-client.key"

# Make readable by non-root processes in CI runner
chmod 644 "$OUT"/* || true

echo "Wrote certs to $OUT"
ls -la "$OUT"

