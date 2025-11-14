# Proof Package Specification

This document defines the canonical package format returned by `GET /finance/proof`. Auditors rely on it to validate that ledger entries between `from` and `to` have not been tampered with and that payouts line up with the ledger and external providers.

## Overview
A proof package is a deterministic archive (either JSON or TAR) containing:
1. `manifest.json` — metadata about the interval and cryptographic material.
2. `ledger.jsonl` — canonicalized ledger slice sorted by `(timestamp, journalId)` with stable key ordering.
3. `hashchain.json` — hash chain links for each ledger chunk.
4. `signature.json` — detached signatures emitted by the signing proxy along with signer quorum metadata.

All files use UTF-8 and RFC 3339 timestamps. Amounts are strings with two decimal places.

## Manifest
```json
{
  "range": { "from": "2024-01-01T00:00:00Z", "to": "2024-01-02T00:00:00Z" },
  "entries": 1200,
  "hashAlgorithm": "SHA-256",
  "chunkSize": 500,
  "exportVersion": 1,
  "proofId": "uuid",
  "signers": [
    { "role": "FinanceLead", "keyId": "arn:aws:kms:...:key/1", "signature": "base64" },
    { "role": "SecurityEngineer", "keyId": ".../key/2", "signature": "base64" }
  ]
}
```

## Ledger Lines
Each line in `ledger.jsonl` is a stable JSON object produced via `utils/canonicalize.ts`:
```json
{"journalId":"uuid","timestamp":"2024-01-01T00:00:00Z","currency":"USD","lines":[{"accountId":"cash","direction":"debit","amount":"100.00"},{"accountId":"revenue","direction":"credit","amount":"100.00"}],"metadata":{"source":"marketplace","orderId":"o123"}}
```

## Hash Chain
`hashchain.json` contains:
```json
{
  "algorithm": "SHA-256",
  "chain": [
    { "chunk": 0, "range": { "start": 0, "end": 499 }, "hash": "..." },
    { "chunk": 1, "range": { "start": 500, "end": 999 }, "hash": "...", "prev": "hash-of-prev" }
  ]
}
```
Auditors recompute hashes over canonicalized ledger chunks and ensure the final hash matches `manifest.rootHash`.

## Signatures
The signing proxy receives the manifest hash and coordinates multisig signers. `signature.json` captures:
```json
{
  "manifestHash": "hex",
  "rootHash": "hex",
  "signatures": [
    {
      "keyId": "arn:aws:kms:...:key/1",
      "role": "FinanceLead",
      "signature": "base64",
      "algorithm": "ECDSA_P256_SHA256",
      "signedAt": "2024-01-02T00:10:00Z"
    }
  ]
}
```

## Verification Steps
1. Validate package integrity (if TAR, verify checksums).
2. Recreate ledger chunk hashes and chain. Ensure `hashchain.chain[-1].hash == manifest.rootHash`.
3. Hash `manifest.json` and compare to `signature.manifestHash`.
4. Verify each signature via the public keys referenced in `kms_policy.json`.
5. Confirm number of unique approver roles satisfies `security/multisig_policy.md`.

## Deterministic Rules
- Keys sorted lexicographically.
- No whitespace in JSONL.
- Amount strings zero-padded to two decimals.
- Metadata keys sorted.
- Hash inputs encoded as UTF-8 JSON strings.

These rules enable reproducible reconciliation drills and automated verification tooling in `exports/audit_verifier_cli.ts`.
