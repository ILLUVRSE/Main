#!/usr/bin/env node
/**
 * marketplace/test/helpers/verifyWebhookSig.js
 *
 * Simple helper to verify payment webhook signatures (Stripe-style and generic HMAC-SHA256).
 *
 * Usage:
 *   node verifyWebhookSig.js --payload ./test/fixtures/webhook.json --sig "t=...,v1=..." --secret $WEBHOOK_SECRET
 *
 * Exits code 0 if verified, non-zero otherwise.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function usageAndExit(code = 1) {
  console.log(`Usage:
  node ${path.basename(process.argv[1])} --payload PATH --sig SIGNATURE --secret SECRET

Options:
  --payload  Path to the raw payload file (string/JSON). IMPORTANT: use the raw bytes the webhook provider signed.
  --sig      Signature header or raw signature. For Stripe-style provide the header: "t=...,v1=..."
  --secret   Shared secret (e.g., Stripe webhook secret) used to compute the HMAC-SHA256.
  --help     Show this help.
`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      break;
    }
    if (a === '--payload') {
      args.payload = argv[++i];
      continue;
    }
    if (a === '--sig') {
      args.sig = argv[++i];
      continue;
    }
    if (a === '--secret') {
      args.secret = argv[++i];
      continue;
    }
    // ignore unknown
  }
  return args;
}

function timingSafeEqualStr(a, b) {
  try {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function computeHmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function computeHmacBase64(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64');
}

function parseStripeHeader(sigHeader) {
  // Example: "t=1668594582,v1=5257b0...,v0=..."
  const parts = sigHeader.split(',').map((s) => s.trim());
  const out = {};
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k && v) out[k] = v;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.payload || !args.sig || !args.secret) {
    usageAndExit(args.help ? 0 : 1);
  }

  const payloadPath = String(args.payload);
  if (!fs.existsSync(payloadPath)) {
    console.error(`ERROR: payload file not found: ${payloadPath}`);
    process.exit(2);
  }

  // Read raw payload *bytes* as utf8 string
  const rawPayload = fs.readFileSync(payloadPath, { encoding: 'utf8' });

  const signatureInput = String(args.sig);
  const secret = String(args.secret);

  let verified = false;
  let details = {};

  // If signature looks like stripe header, parse t and v1 and compute HMAC over "t.payload"
  if (/(^|\s)t=\d+/.test(signatureInput) && /v1=/.test(signatureInput)) {
    const parsed = parseStripeHeader(signatureInput);
    const t = parsed.t;
    const v1 = parsed.v1;
    if (!t || !v1) {
      console.error('ERROR: Stripe-style signature provided but missing t or v1 fields.');
      process.exit(3);
    }
    const signedPayload = `${t}.${rawPayload}`;
    const computedHex = computeHmacHex(secret, signedPayload);
    verified = timingSafeEqualStr(computedHex, v1);
    details = { method: 'stripe-header', timestamp: t, expected: v1, computedHex };
  } else {
    // Generic HMAC: compute hmac over raw payload
    const computedHex = computeHmacHex(secret, rawPayload);
    const computedB64 = computeHmacBase64(secret, rawPayload);
    // Try equality against provided signature in both hex and base64 forms (case-insensitive for hex)
    const sigLower = signatureInput.toLowerCase();
    verified = timingSafeEqualStr(computedHex.toLowerCase(), sigLower.toLowerCase()) || timingSafeEqualStr(computedB64, signatureInput);
    details = { method: 'generic-hmac', providedSig: signatureInput, computedHex, computedB64 };
  }

  if (verified) {
    console.log(JSON.stringify({ ok: true, verified: true, details }, null, 2));
    process.exit(0);
  } else {
    console.error(JSON.stringify({ ok: false, verified: false, details }, null, 2));
    process.exit(4);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled error in verifyWebhookSig:', err && err.stack ? err.stack : err);
    process.exit(99);
  });
}

