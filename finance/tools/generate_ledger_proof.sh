#!/usr/bin/env bash
set -euo pipefail

### finance/tools/generate_ledger_proof.sh
###
### Generate a signed ledger proof for a date range.
### Produces a JSON proof file with: proof_id, range, hash, signer_kid, signature, ts
###
### Usage:
###   ./generate_ledger_proof.sh --from 2025-11-01T00:00:00Z --to 2025-11-30T23:59:59Z \
###       --db "postgres://postgres:postgres@localhost:5432/finance" \
###       --out ./proof.json \
###       [ --signing-proxy https://signer.example.com ] \
###       [ --kms-key-id arn:aws:kms:... --kms-algorithm rsa-sha256 ] \
###       [ --dev-private-key /path/to/dev_priv.pem --signer-kid dev-signer ]
###
### Examples:
###  1) Sign with signing-proxy:
###     ./generate_ledger_proof.sh --from ... --to ... --db "$DATABASE_URL" --out /tmp/proof.json --signing-proxy https://localhost:7000
###
###  2) Sign with AWS KMS (RSA PKCS1 v1.5 SHA-256):
###     ./generate_ledger_proof.sh --from ... --to ... --db "$DATABASE_URL" --out /tmp/proof.json --kms-key-id arn:aws:kms:... --kms-algorithm rsa-sha256 --signer-kid finance-kms-v1
###
###  3) Local dev signing (not for prod):
###     AUDIT_SIGNING_PRIVATE_KEY=/home/dev/tmp_priv.pem ./generate_ledger_proof.sh --from ... --to ... --db "$DATABASE_URL" --out /tmp/proof.json --signer-kid dev-local

# Utilities present?
command -v jq >/dev/null 2>&1 || { echo "jq required. Install jq."; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl required. Install openssl."; exit 1; }

# Defaults
OUT_FILE=""
DB_URL="${DATABASE_URL:-}"
FROM_TS=""
TO_TS=""
SIGNING_PROXY_URL=""
KMS_KEY_ID=""
KMS_SIGN_ALG=""   # e.g., rsa-sha256
DEV_PRIV_KEY="${AUDIT_SIGNING_PRIVATE_KEY:-}"
SIGNER_KID=""
TMP_DIR="$(mktemp -d /tmp/generate_ledger_proof.XXXX)"
CANON_JSONL="${TMP_DIR}/ledger_rows.canonical.jsonl"
DIGEST_BIN="${TMP_DIR}/digest.bin"
SIG_B64="${TMP_DIR}/signature.b64"
PROOF_ID=""
VERBOSE=0

usage() {
  cat <<EOF
Usage: $0 --from <ISO> --to <ISO> --db <DB_URL> --out <file> [options]

Options:
  --from <ISO>               from timestamp (inclusive)
  --to <ISO>                 to timestamp (inclusive)
  --db <DATABASE_URL>        Postgres JDBC/psql URL (postgres://user:pw@host:port/db)
  --out <file>               output proof JSON path
  --signing-proxy <url>      signing proxy base URL (POST /sign)
  --kms-key-id <key-id>      KMS key id or ARN for aws kms sign
  --kms-algorithm <alg>      signing algorithm (e.g. rsa-sha256) for KMS
  --dev-private-key <path>   local PEM private key (dev only — not for prod)
  --signer-kid <kid>         signer id to embed in proof (required for KMS/dev)
  --sql <file>               optional SQL file to fetch canonical rows (default impl provided)
  -v                         verbose

Examples:
  $0 --from 2025-11-01T00:00:00Z --to 2025-11-30T23:59:59Z --db "\$DATABASE_URL" --out /tmp/proof.json --signing-proxy https://signer:7000

EOF
}

# parse args
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM_TS="$2"; shift 2;;
    --to) TO_TS="$2"; shift 2;;
    --db) DB_URL="$2"; shift 2;;
    --out) OUT_FILE="$2"; shift 2;;
    --signing-proxy) SIGNING_PROXY_URL="$2"; shift 2;;
    --kms-key-id) KMS_KEY_ID="$2"; shift 2;;
    --kms-algorithm) KMS_SIGN_ALG="$2"; shift 2;;
    --dev-private-key) DEV_PRIV_KEY="$2"; shift 2;;
    --signer-kid) SIGNER_KID="$2"; shift 2;;
    --sql) CUSTOM_SQL_FILE="$2"; shift 2;;
    -v) VERBOSE=1; shift;;
    -h|--help) usage; exit 0;;
    *) POSITIONAL+=("$1"); shift;;
  esac
done

if [ -z "$FROM_TS" ] || [ -z "$TO_TS" ] || [ -z "$DB_URL" ] || [ -z "$OUT_FILE" ]; then
  echo "Missing required args." >&2
  usage
  exit 2
fi

if [ -z "$SIGNING_PROXY_URL" ] && [ -z "$KMS_KEY_ID" ] && [ -z "$DEV_PRIV_KEY" ]; then
  echo "Error: You must specify a signing backend: --signing-proxy or --kms-key-id or set AUDIT_SIGNING_PRIVATE_KEY (dev only)." >&2
  exit 2
fi

if [ -z "$SIGNER_KID" ]; then
  if [ -n "$KMS_KEY_ID" ]; then
    SIGNER_KID="${KMS_KEY_ID}"
  elif [ -n "$DEV_PRIV_KEY" ]; then
    SIGNER_KID="${SIGNER_KID:-dev-local}"
  fi
fi

if [ -z "$SIGNER_KID" ]; then
  echo "Warning: signer_kid not set. It's recommended to pass --signer-kid to identify signer." >&2
fi

if [ "$VERBOSE" -eq 1 ]; then
  echo "CONFIG:"
  echo "  FROM_TS=$FROM_TS"
  echo "  TO_TS=$TO_TS"
  echo "  DB_URL=$DB_URL"
  echo "  OUT_FILE=$OUT_FILE"
  echo "  SIGNING_PROXY_URL=$SIGNING_PROXY_URL"
  echo "  KMS_KEY_ID=$KMS_KEY_ID"
  echo "  KMS_SIGN_ALG=$KMS_SIGN_ALG"
  echo "  DEV_PRIV_KEY=$DEV_PRIV_KEY"
  echo "  SIGNER_KID=$SIGNER_KID"
  echo "  TMP_DIR=$TMP_DIR"
fi

# Default SQL extractor — adapt to your finance schema.
# The query produces one canonical JSON row per ledger row. Update to match your schema.
# By default we assume a table `ledger_rows` with a sensible JSON representation.
DEFAULT_SQL=$(cat <<'SQL'
WITH rows AS (
  SELECT
    id,
    journal_id,
    account_id,
    side,
    amount_cents,
    currency,
    context,
    created_at
  FROM ledger_rows
  WHERE created_at >= $1::timestamptz
    AND created_at <= $2::timestamptz
  ORDER BY created_at, id
)
SELECT row_to_json(r) FROM rows r;
SQL
)

# If user provided a custom SQL file, use that. Otherwise use default.
if [ -n "${CUSTOM_SQL_FILE:-}" ]; then
  if [ ! -f "$CUSTOM_SQL_FILE" ]; then
    echo "Custom SQL file $CUSTOM_SQL_FILE not found." >&2
    exit 1
  fi
  SQL_QUERY="$(cat "$CUSTOM_SQL_FILE")"
else
  SQL_QUERY="$DEFAULT_SQL"
fi

# Run SQL and produce canonical JSONL
echo "[generate_ledger_proof] extracting ledger rows from DB..."
# Using psql -c with parameters $1/$2 — create temporary file for query to avoid shell quoting issues
PSQL_BIN="${PSQL_BIN:-psql}"
# Ensure DB_URL is exported for psql
export DATABASE_URL="$DB_URL"

# Create a small wrapper SQL that replaces $1/$2 with quoted timestamps for psql.
# We'll use psql -t -A -F $'\n' -c "SQL" so that each row_to_json is printed one per line.
SQL_WRAPPER="$(cat <<SQL
$(echo "$SQL_QUERY") ;
SQL
)"

# Run the query
# Note: psql will print rows one per line; we then canonicalize with jq -S.
set +e
# Use psql -t -A to get bare output lines
echo "$SQL_WRAPPER" | $PSQL_BIN "$DB_URL" -v ON_ERROR_STOP=1 -q -t -A -c "$SQL_WRAPPER" > "${TMP_DIR}/rows_raw.txt" 2> "${TMP_DIR}/psql.err"
PSQL_EXIT=$?
set -e
if [ "$PSQL_EXIT" -ne 0 ]; then
  echo "psql query failed. See ${TMP_DIR}/psql.err for details." >&2
  cat "${TMP_DIR}/psql.err" >&2 || true
  exit 1
fi

# psql may include empty lines; filter them
grep -v '^$' "${TMP_DIR}/rows_raw.txt" > "${TMP_DIR}/rows_nonempty.txt" || true

# Canonicalize each JSON row: sort keys deterministically (jq -c -S)
echo "[generate_ledger_proof] canonicalizing JSON rows..."
> "$CANON_JSONL"
while IFS= read -r line; do
  # ensure valid JSON; if not, skip with warning
  if echo "$line" | jq -e . >/dev/null 2>&1; then
    echo "$line" | jq -c -S '.' >> "$CANON_JSONL"
  else
    echo "[generate_ledger_proof][WARN] skipping non-json line: $line" >&2
  fi
done < "${TMP_DIR}/rows_nonempty.txt"

ROW_COUNT=$(wc -l < "$CANON_JSONL" || echo 0)
echo "[generate_ledger_proof] canonicalized ${ROW_COUNT} rows -> $CANON_JSONL"

# Create digest: canonicalized JSONL bytes concatenated with newline between lines
echo "[generate_ledger_proof] computing SHA-256 digest of canonicalized rows..."
# Ensure deterministic: use UNIX newlines
tr -d '\r' < "$CANON_JSONL" > "${TMP_DIR}/rows_unix.jsonl"
# Compute SHA256 digest (binary) -> DIGEST_BIN
openssl dgst -sha256 -binary "${TMP_DIR}/rows_unix.jsonl" > "$DIGEST_BIN"
HASH_HEX=$(openssl dgst -sha256 "${TMP_DIR}/rows_unix.jsonl" | awk '{print $2}')
echo "[generate_ledger_proof] hash (hex): $HASH_HEX"

# Sign digest using chosen backend
SIGNATURE_B64=""
SIGNED_BY=""
TIMESTAMP_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [ -n "$SIGNING_PROXY_URL" ]; then
  echo "[generate_ledger_proof] signing via signing-proxy: $SIGNING_PROXY_URL"
  # signing proxy expected API: POST $SIGNING_PROXY_URL/sign with JSON { payload_b64: "<base64(digest)>" }
  DIGEST_B64=$(base64 -w0 < "$DIGEST_BIN")
  # Try to POST and extract signature_b64 and signer_kid
  RESP=$(curl -fsS -X POST "${SIGNING_PROXY_URL%/}/sign" -H "Content-Type: application/json" \
    -d "{\"payload_b64\":\"${DIGEST_B64}\"}" 2> "${TMP_DIR}/signer_proxy.err" || true)
  if [ -z "$RESP" ]; then
    echo "Signing proxy request failed. See ${TMP_DIR}/signer_proxy.err" >&2
    cat "${TMP_DIR}/signer_proxy.err" >&2 || true
    exit 1
  fi
  SIGNATURE_B64=$(echo "$RESP" | jq -r '.signature_b64 // .signature // empty')
  SIGNED_BY=$(echo "$RESP" | jq -r '.signer_kid // .signerId // empty')
  if [ -z "$SIGNATURE_B64" ]; then
    echo "Signing proxy didn't return signature_b64. Response: $RESP" >&2
    exit 1
  fi
  if [ -z "$SIGNED_BY" ]; then
    echo "[generate_ledger_proof][WARN] signing proxy did not report signer_kid; using provided SIGNER_KID" >&2
    SIGNED_BY="${SIGNER_KID:-signing-proxy}"
  fi

elif [ -n "$KMS_KEY_ID" ]; then
  echo "[generate_ledger_proof] signing via AWS KMS (key: $KMS_KEY_ID, alg: $KMS_SIGN_ALG)"
  # KMS sign expects binary payload file for RAW digest with rsa-sha256 algorithm.
  # Map friendly algorithm names to AWS signing algorithms if needed.
  if [ -z "$KMS_SIGN_ALG" ]; then
    echo "KMS algorithm required (e.g., rsa-sha256). Use --kms-algorithm." >&2
    exit 2
  fi

  # Choose AWS CLI sign args depending on algorithm
  # Example: RSASSA_PKCS1_V1_5_SHA_256 => rsa-sha256
  case "$KMS_SIGN_ALG" in
    rsa-sha256) AWS_SIGN_ALG="RSASSA_PKCS1_V1_5_SHA_256" ;;
    aws256|RSASSA_PKCS1_V1_5_SHA_256) AWS_SIGN_ALG="RSASSA_PKCS1_V1_5_SHA_256" ;;
    *) AWS_SIGN_ALG="$KMS_SIGN_ALG" ;;
  esac

  if ! command -v aws >/dev/null 2>&1; then
    echo "aws CLI required for KMS signing. Install and configure aws CLI." >&2
    exit 1
  fi

  # Use aws kms sign with --message-type RAW and read signature base64 from output
  TMP_KMS_OUT="${TMP_DIR}/kms_sign_out.json"
  aws kms sign --key-id "$KMS_KEY_ID" --message-type RAW --signing-algorithm "$AWS_SIGN_ALG" --message fileb://"${DIGEST_BIN}" --output json > "$TMP_KMS_OUT"
  if [ $? -ne 0 ]; then
    echo "aws kms sign failed. Check aws cli config/permissions." >&2
    cat "$TMP_KMS_OUT" >&2 || true
    exit 1
  fi
  # The signature is base64 in JSON
  SIGNATURE_B64=$(jq -r '.Signature' "$TMP_KMS_OUT" | base64 -d | base64 -w0)
  SIGNED_BY="${SIGNER_KID:-$KMS_KEY_ID}"
  # Note: with AWS CLI the Signature field is base64 raw; we re-base64 to ensure no newlines.
  if [ -z "$SIGNATURE_B64" ]; then
    echo "KMS did not return a signature (unexpected)." >&2
    exit 1
  fi

elif [ -n "$DEV_PRIV_KEY" ]; then
  echo "[generate_ledger_proof] signing locally with dev private key (DEV ONLY)"
  if [ ! -f "$DEV_PRIV_KEY" ]; then
    echo "Dev private key $DEV_PRIV_KEY not found." >&2
    exit 1
  fi
  # Use openssl to sign the digest with RSA SHA256
  openssl pkeyutl -sign -in "$DIGEST_BIN" -inkey "$DEV_PRIV_KEY" -pkeyopt digest:sha256 -out "${TMP_DIR}/sig.bin"
  base64 -w0 < "${TMP_DIR}/sig.bin" > "$SIG_B64"
  SIGNATURE_B64="$(cat "$SIG_B64")"
  SIGNED_BY="${SIGNER_KID:-dev-local}"
else
  echo "No signing backend selected. Exiting." >&2
  exit 1
fi

if [ -z "$SIGNATURE_B64" ]; then
  echo "Signature generation failed (empty)." >&2
  exit 1
fi

# Build proof JSON
PROOF_ID="ledger-proof-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 6)"
PROOF_JSON="$(jq -n \
  --arg pid "$PROOF_ID" \
  --arg from "$FROM_TS" \
  --arg to "$TO_TS" \
  --arg hash "$HASH_HEX" \
  --arg signer "$SIGNED_BY" \
  --arg sig "$SIGNATURE_B64" \
  --arg ts "$TIMESTAMP_ISO" \
  --argjson rows_count "$ROW_COUNT" \
  '{
    proof_id: $pid,
    range: { from_ts: $from, to_ts: $to },
    hash: $hash,
    signer_kid: $signer,
    signature: $sig,
    ts: $ts,
    num_rows: $rows_count
  }')"

# Write proof to out file
mkdir -p "$(dirname "$OUT_FILE")"
echo "$PROOF_JSON" | jq '.' > "$OUT_FILE"

echo "[generate_ledger_proof] Proof written to $OUT_FILE"
echo "[generate_ledger_proof] proof_id: $PROOF_ID"
echo "[generate_ledger_proof] signer_kid: $SIGNED_BY"
echo "[generate_ledger_proof] rows: $ROW_COUNT"
echo "[generate_ledger_proof] cleaning up temp dir $TMP_DIR"

# Optionally include canonical ledger rows next to proof
CANON_DEST="${OUT_FILE%.*}.ledger_rows.jsonl.gz"
gzip -c "$CANON_JSONL" > "$CANON_DEST"
echo "[generate_ledger_proof] wrote canonical ledger rows to $CANON_DEST"

# Emit an audit-style message to stdout
jq -n --arg pid "$PROOF_ID" --arg signer "$SIGNED_BY" --arg out "$OUT_FILE" --arg ts "$TIMESTAMP_ISO" \
  '{proof_id: $pid, signer_kid: $signer, proof_file: $out, created_at: $ts}' | jq '.'

# Done
exit 0

