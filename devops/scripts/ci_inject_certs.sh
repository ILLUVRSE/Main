#!/usr/bin/env bash
set -euo pipefail

OUT=${1:-/tmp/illuvrse-certs}

# Defensive: ensure a private directory for certs
mkdir -p "$OUT"
chmod 700 "$OUT"

# Expect base64-encoded certs in env (fail fast if missing)
: "${CI_KERNEL_CA:?CI_KERNEL_CA required (base64)}"
: "${CI_KERNEL_SERVER_CERT:?CI_KERNEL_SERVER_CERT required (base64)}"
: "${CI_KERNEL_SERVER_KEY:?CI_KERNEL_SERVER_KEY required (base64)}"
: "${CI_KERNEL_CLIENT_CERT:?CI_KERNEL_CLIENT_CERT required (base64)}"
: "${CI_KERNEL_CLIENT_KEY:?CI_KERNEL_CLIENT_KEY required (base64)}"

cleanup() {
  # do not remove all files in OUT; only remove partially written files if present
  for f in kernel-ca.crt kernel-server.crt kernel-server.key kernel-client.crt kernel-client.key; do
    [ -f "$OUT/$f.tmp" ] && rm -f "$OUT/$f.tmp" || true
  done
}
trap cleanup EXIT

write_file() {
  local envvar="$1"
  local dest="$2"
  # decode to a temp file first
  local tmp="$dest.tmp"
  echo "Writing $dest"
  printf '%s' "${!envvar}" | base64 --decode > "$tmp"
  # basic validation: file exists and has some content and contains PEM BEGIN marker
  if [ ! -s "$tmp" ]; then
    echo "ERROR: decoded $dest is empty"
    rm -f "$tmp"
    exit 1
  fi
  if ! grep -q "BEGIN" "$tmp" >/dev/null 2>&1; then
    echo "WARNING: $dest does not appear to be a PEM file (no BEGIN marker)"
    # still move it — caller may be using different formats
  fi
  mv "$tmp" "$dest"
}

# Decode and write files (use base64 env vars)
write_file CI_KERNEL_CA "$OUT/kernel-ca.crt"
write_file CI_KERNEL_SERVER_CERT "$OUT/kernel-server.crt"
write_file CI_KERNEL_SERVER_KEY "$OUT/kernel-server.key"
write_file CI_KERNEL_CLIENT_CERT "$OUT/kernel-client.crt"
write_file CI_KERNEL_CLIENT_KEY "$OUT/kernel-client.key"

# Set permissions:
# - private keys 600 (owner read/write)
# - certs 644 (owner read/write, group/other read)
chmod 600 "$OUT"/*.key || true
chmod 644 "$OUT"/*.crt || true

# Final listing (do not print file contents)
echo "Wrote cert files to $OUT (owners/permissions shown):"
ls -l "$OUT" | sed -n '1,200p'

# Helpful note for CI runners
cat <<EOF
NOTE: In CI, prefer to set:
  NODE_EXTRA_CA_CERTS=${OUT}/kernel-ca.crt
instead of NODE_TLS_REJECT_UNAUTHORIZED=0 so Node trusts the test CA for HTTPS calls.
EOF

# success: clear trap cleanup
trap - EXIT

