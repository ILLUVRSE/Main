#!/usr/bin/env node
/*
 * Minimal Finance mock used by Marketplace E2E and CI runs.
 * Exposes deterministic endpoints for settlements, ledger posts, and proofs.
 */
const express = require('express');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8050);
const SIGNER_KID = process.env.FINANCE_SIGNER_KID || 'finance-mock-signer-v1';
const app = express();
app.use(express.json({ limit: '1mb' }));

const proofs = new Map();
let seq = 0;
const nextSeq = () => {
  seq += 1;
  return seq;
};

const now = () => new Date().toISOString();
const deterministicId = (prefix, seed) => {
  const hash = crypto.createHash('sha256').update(`${seed}` || 'seed').digest('hex');
  return `${prefix}-${hash.slice(0, 12)}`;
};
const deterministicSignature = (label) => Buffer.from(label).toString('base64');

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'ready', ts: now() });
});

app.post(['/settlement', '/settle'], (req, res) => {
  const payload = req.body || {};
  const ledgerProofId = deterministicId('ledger-proof', `${JSON.stringify(payload)}:${nextSeq()}`);
  const response = {
    ok: true,
    ledger_proof_id: ledgerProofId,
    signer_kid: SIGNER_KID,
    signature: deterministicSignature(`ledger:${ledgerProofId}`),
    ts: now(),
    received: payload,
  };
  res.json(response);
});

app.post('/ledger/post', (req, res) => {
  const payload = req.body || {};
  const journalId = deterministicId('journal', `${JSON.stringify(payload)}:${nextSeq()}`);
  res.json({ ok: true, journal_id: journalId, ts: now() });
});

app.post('/proofs/generate', (req, res) => {
  const payload = req.body || {};
  const proofId = deterministicId('proof', `${JSON.stringify(payload)}:${nextSeq()}`);
  proofs.set(proofId, {
    proof_id: proofId,
    payload,
    requested_at: now(),
  });
  res.json({ ok: true, proof_id: proofId, status: 'generating' });
});

app.get('/proofs/:proofId', (req, res) => {
  const proofId = req.params.proofId;
  const stored = proofs.get(proofId);
  if (!stored) {
    return res.status(404).json({ ok: false, error: 'proof_not_found', proof_id: proofId });
  }
  res.json({
    ok: true,
    proof_id: proofId,
    status: 'ready',
    signer_kid: SIGNER_KID,
    signature: deterministicSignature(`proof:${proofId}`),
    ts: now(),
    payload: stored.payload,
  });
});

const server = app.listen(PORT, () => {
  console.log(`[finance-mock] Listening on http://127.0.0.1:${PORT}`);
});

const shutdown = () => {
  console.log('[finance-mock] Shutting down');
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
