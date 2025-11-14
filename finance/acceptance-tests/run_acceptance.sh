#!/usr/bin/env bash
set -euo pipefail

npm test -- finance/test/unit/journal.test.ts
npm test -- finance/test/integration/reconcile.test.ts
npm test -- finance/test/e2e/payment_payout_flow.test.ts

OUT_DIR=$(mktemp -d)
npx tsc finance/exports/audit_verifier_cli.ts --outDir "$OUT_DIR" --module commonjs --target ES2020 --esModuleInterop --moduleResolution node
node "$OUT_DIR/finance/exports/audit_verifier_cli.js" finance/exports/sample_proof_package.json
