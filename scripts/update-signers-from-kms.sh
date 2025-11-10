#!/usr/bin/env bash
# scripts/update-signers-from-kms.sh
# Fetch public key from KMS, convert to PEM, update kernel/tools/signers.json,
# create a branch, commit and open a PR for audit review.
#
# Requirements for running this script locally or in CI:
# - aws CLI configured or OIDC role available in env
# - gh (GitHub CLI) configured for PR creation
# - jq (>=1.6), openssl, git
set -euo pipefail

KEY_ID="${AUDIT_SIGNING_KMS_KEY_ID:-}"
if [ -z "$KEY_ID" ]; then
  echo "ERROR: AUDIT_SIGNING_KMS_KEY_ID env var is required"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIGNERS_PATH="$ROOT_DIR/kernel/tools/signers.json"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Fetching public key for KMS key: $KEY_ID"

# Fetch public key (base64 output) and decode to DER
PUB_B64="$(aws kms get-public-key --key-id "$KEY_ID" --query PublicKey --output text 2>/dev/null || true)"
if [ -z "$PUB_B64" ]; then
  echo "ERROR: aws kms get-public-key did not return PublicKey. Check permissions/key type."
  exit 2
fi

echo "$PUB_B64" | base64 --decode > "$TMP_DIR/pub.der"

# Try DER -> PEM conversion
set +e
openssl pkey -pubin -inform DER -in "$TMP_DIR/pub.der" -out "$TMP_DIR/pub.pem" 2>/dev/null
rc=$?
if [ $rc -ne 0 ]; then
  # Try RSA-specific conversion
  openssl rsa -pubin -inform DER -in "$TMP_DIR/pub.der" -out "$TMP_DIR/pub.pem" 2>/dev/null || true
fi
set -e

# If still no PEM and length == 32 bytes, treat as raw Ed25519 and add SPKI prefix
if [ ! -s "$TMP_DIR/pub.pem" ]; then
  LEN=$(wc -c < "$TMP_DIR/pub.der" | tr -d ' ')
  if [ "$LEN" -eq 32 ]; then
    # ED25519 SPKI prefix (hex): 302a300506032b6570032100
    printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00' > "$TMP_DIR/prefix.bin"
    cat "$TMP_DIR/prefix.bin" "$TMP_DIR/pub.der" > "$TMP_DIR/pub_spki.der"
    openssl pkey -pubin -inform DER -in "$TMP_DIR/pub_spki.der" -out "$TMP_DIR/pub.pem"
  fi
fi

if [ ! -s "$TMP_DIR/pub.pem" ]; then
  echo "ERROR: Could not convert public key to PEM. Please check key type and openssl support."
  exit 3
fi

# Normalize PEM to ensure consistent newlines
awk 'BEGIN{ORS="\n"}{print}' "$TMP_DIR/pub.pem" > "$TMP_DIR/pub.pem.norm"

# Ensure signers.json exists and is valid JSON; create an empty object if missing
if [ ! -f "$SIGNERS_PATH" ]; then
  mkdir -p "$(dirname "$SIGNERS_PATH")"
  echo "{}" > "$SIGNERS_PATH"
fi

# Validate existing JSON
if ! jq empty "$SIGNERS_PATH" >/dev/null 2>&1; then
  echo "ERROR: Existing $SIGNERS_PATH is not valid JSON. Aborting."
  exit 4
fi

# Backup existing signers.json
cp "$SIGNERS_PATH" "${SIGNERS_PATH}.bak.$(date -u +"%Y%m%dT%H%M%SZ")"

# Use jq --rawfile to inject PEM as a raw string (requires jq >= 1.6)
# Key in the registry will be the exact AUDIT_SIGNING_KMS_KEY_ID (ARN or KeyId)
jq --arg key "$KEY_ID" --rawfile pem "$TMP_DIR/pub.pem.norm" '.[$key]=$pem' "$SIGNERS_PATH" > "$SIGNERS_PATH.new"
mv "$SIGNERS_PATH.new" "$SIGNERS_PATH"

echo "Updated $SIGNERS_PATH (backup created)."

# Create branch, commit, push, and open PR for auditable review
BRANCH="update/signers/$(echo "$KEY_ID" | tr '/:' '--' | tr -c '[:alnum:]-' '-')-$(date -u +%Y%m%d%H%M%S)"
git checkout -b "$BRANCH"
git add "$SIGNERS_PATH"
git commit -m "chore(signers): update signer public key for $KEY_ID"
git push origin "$BRANCH"

# Create PR and request security review
PR_TITLE="chore(signers): update signer public key for $KEY_ID"
PR_BODY="Automated update of kernel/tools/signers.json from KMS key ${KEY_ID}.\n\nThis updates the PEM public key used by audit verification. Please review and merge if acceptable."
gh pr create --title "$PR_TITLE" --body "$PR_BODY" --reviewer security-engineering || {
  echo "PR created (or gh failed to auto-request reviewer). Please open a PR manually if needed."
}

echo "Signers file updated, branch pushed, and PR requested: $BRANCH"

