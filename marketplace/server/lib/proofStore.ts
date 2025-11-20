type ProofRecord = {
  proof_id: string;
  order_id?: string;
  artifact_sha256?: string;
  manifest_signature_id?: string;
  ledger_proof_id?: string;
  signer_kid?: string;
  signature?: string;
  ts?: string;
  canonical_payload?: any;
};

function getDb(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dbMod = require('./db');
    return dbMod && (dbMod.default || dbMod);
  } catch {
    return null;
  }
}

export async function persistProof(proof: ProofRecord) {
  const db = getDb();
  if (!db || typeof db.query !== 'function') return;

  const q = `INSERT INTO proofs (proof_id, order_id, artifact_sha256, manifest_signature_id, ledger_proof_id, signer_kid, signature, ts, canonical_payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (proof_id) DO UPDATE SET
      order_id = EXCLUDED.order_id,
      artifact_sha256 = EXCLUDED.artifact_sha256,
      manifest_signature_id = EXCLUDED.manifest_signature_id,
      ledger_proof_id = EXCLUDED.ledger_proof_id,
      signer_kid = EXCLUDED.signer_kid,
      signature = EXCLUDED.signature,
      ts = EXCLUDED.ts,
      canonical_payload = EXCLUDED.canonical_payload`;

  const params = [
    proof.proof_id,
    proof.order_id || null,
    proof.artifact_sha256 || null,
    proof.manifest_signature_id || null,
    proof.ledger_proof_id || null,
    proof.signer_kid || null,
    proof.signature || null,
    proof.ts || new Date().toISOString(),
    proof.canonical_payload || null,
  ];

  try {
    await db.query(q, params);
  } catch (err) {
    console.debug('persistProof failed:', (err as Error).message);
  }
}
