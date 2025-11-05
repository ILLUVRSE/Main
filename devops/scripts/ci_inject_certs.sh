#!/usr/bin/env bash
# devops/scripts/ci_inject_certs.sh
# Decode base64-encoded cert/key secrets from environment variables and write
# them into a secure directory for Docker Compose / tests to mount.
#
# Usage:
#   OUT_DIR=/tmp/illuvrse-certs ./ci_inject_certs.sh
#
# This script is intentionally conservative:
# - sets restrictive permissions (dir 700, files 600)
# - is idempotent (overwrites files)
# - supports common variable names used by CI workflows
#
set -euo pipefail

OUT_DIR="${OUT_DIR:-${RUNNER_TEMP:-$(pwd)}/illuvrse-certs}"
mkdir -p "$OUT_DIR"
# Restrict directory perms
chmod 700 "$OUT_DIR"

# Map env var -> output filename (add or edit pairs below to match your CI secret names)
declare -A FILE_MAP=(
  # Kernel mTLS client cert/key + CA
  ["KERNEL_MTLS_CLIENT_CERT_B64"]="kernel-client.crt"
  ["KERNEL_MTLS_CLIENT_KEY_B64"]="kernel-client.key"
  ["KERNEL_MTLS_CA_B64"]="kernel-ca.crt"
  # Kernel client PKCS12 if provided
  ["KERNEL_MTLS_CLIENT_P12_B64"]="kernel-client.p12"

  # KMS mTLS client cert/key (optional)
  ["KMS_MTLS_CLIENT_CERT_B64"]="kms-client.crt"
  ["KMS_MTLS_CLIENT_KEY_B64"]="kms-client.key"

  # Any other named certs you want to support in CI:
  # ["OTHER_SERVICE_CERT_B64"]="other-service.crt"
  # ["OTHER_SERVICE_KEY_B64"]="other-service.key"
)

# Helper: try various base64 decode commands to improve portability
decode_base64_to_file() {
  local b64="$1"
  local out="$2"

  # Try POSIX base64 --decode or -d, then openssl, then python3 fallback.
  if printf '%s' "$b64" | base64 --decode >"$out" 2>/dev/null; then
    return 0
  fi
  if printf '%s' "$b64" | base64 -d >"$out" 2>/dev/null; then
    return 0
  fi
  if command -v openssl >/dev/null 2>&1; then
    # -A for single-line input (GNU/OpenSSL variance)
    if printf '%s' "$b64" | openssl base64 -d -A >"$out" 2>/dev/null; then
      return 0
    fi
    if printf '%s' "$b64" | openssl enc -base64 -d -A >"$out" 2>/dev/null; then
      return 0
    fi
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY >"$out"
import sys, base64
data = sys.stdin.read()
sys.stdout.buffer.write(base64.b64decode(data))
PY
    return 0
  fi

  # If we get here, decoding failed
  return 1
}

created_any=0

for envvar in "${!FILE_MAP[@]}"; do
  outfile="$OUT_DIR/${FILE_MAP[$envvar]}"
  if [ -n "${!envvar:-}" ]; then
    echo "Writing $outfile from \$${envvar}"
    if decode_base64_to_file "${!envvar}" "$outfile"; then
      # Ensure strict perms. Keys and p12 should be 600; certs can be 600 as well for safety.
      chmod 600 "$outfile"
      created_any=1
    else
      echo "ERROR: failed to decode \$${envvar} to $outfile" >&2
      exit 2
    fi
  fi
done

# Optional: if none of the expected env vars existed, exit non-zero so CI can fail loudly.
if [ "$created_any" -eq 0 ]; then
  echo "Warning: no cert env vars found. Nothing written to $OUT_DIR"
  # Not necessarily an error — caller may expect optional certs. Exit 0 but print notice.
fi

# Print summary
echo "Certificates directory: $OUT_DIR"
ls -l "$OUT_DIR" || true

# Export a variable for downstream steps to consume
# In GitHub Actions you can echo "ILLUVRSE_CERT_DIR=$OUT_DIR" >> $GITHUB_ENV
echo "ILLUVRSE_CERT_DIR=$OUT_DIR"

# For CI usage you probably want to write the env var to GITHUB_ENV:
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "ILLUVRSE_CERT_DIR=$OUT_DIR" >> "$GITHUB_ENV"
fi

exit 0

