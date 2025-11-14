#!/usr/bin/env bash
set -euo pipefail

export DATABASE_URL=${DATABASE_URL:-postgres://postgres:finance@127.0.0.1:5433/finance}
export LEDGER_REPO=postgres
export AWS_REGION=${AWS_REGION:-us-east-1}
export AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-localstack}
export AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-localstack}
export KMS_ENDPOINT=${KMS_ENDPOINT:-http://127.0.0.1:4566}
export STRIPE_API_KEY=${STRIPE_API_KEY:-sk_test_123}
export STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-whsec_test}
export STRIPE_API_BASE=${STRIPE_API_BASE:-http://127.0.0.1:12111}
export PAYOUT_PROVIDER_ENDPOINT=${PAYOUT_PROVIDER_ENDPOINT:-http://127.0.0.1:4100}
export S3_AUDIT_BUCKET=${S3_AUDIT_BUCKET:-finance-audit}
export S3_ENDPOINT=${S3_ENDPOINT:-http://127.0.0.1:4566}

export KMS_KEY_ID=$(node finance/infra/bootstrap_localstack.js)

psql "$DATABASE_URL" -f finance/service/src/db/schema.sql >/dev/null

RANGE_FROM=${PROOF_RANGE_FROM:-2024-01-01T00:00:00Z}
RANGE_TO=${PROOF_RANGE_TO:-2025-01-01T00:00:00Z}
EXPORT_JSON=$(npm run --silent finance:export -- "$RANGE_FROM" "$RANGE_TO" | tail -n1)
PROOF_KEY=$(node -e "const res = JSON.parse(process.argv[1]); console.log(res.proofKey);" "$EXPORT_JSON")

PROOF_FILE=$(mktemp)
node <<'NODE' "$PROOF_KEY" "$PROOF_FILE"
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const client = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
async function run() {
  const [key, destination] = process.argv.slice(2);
  const result = await client.send(new GetObjectCommand({ Bucket: process.env.S3_AUDIT_BUCKET, Key: key }));
  const body = await result.Body.transformToString();
  fs.writeFileSync(destination, body);
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});
NODE

npx ts-node finance/exports/audit_verifier_cli.ts "$PROOF_FILE"

DUMP_FILE=$(mktemp)
PGPASSWORD=${PGPASSWORD:-finance} pg_dump -h 127.0.0.1 -p 5433 -U postgres -d finance -f "$DUMP_FILE"
bash finance/backups/restore_drill/run_restore_drill.sh "$DUMP_FILE" "$PROOF_FILE"
