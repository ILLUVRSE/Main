// src/services/signedProofs.ts
/**
 * KMS/HSM-signed proofs for ledger ranges and signed export formats for auditors.
 *
 * Isolation & governance: isolated high-trust environment, multi-sig for high-value actions, mTLS & OIDC for access.
 *
 * This is a placeholder service so TypeScript compilation succeeds; hook it up to the
 * actual signer/KMS clients once the ledger export and audit requirements are finalized.
 */
export class SignedProofs {
  constructor() {
    // Placeholder for dependency injection (KMS clients, audit log writers, etc.)
  }

  async signLedgerRange(_range: unknown) {
    // TODO: integrate with KMS/HSM once the ledger export contract is finalized.
    throw new Error('SignedProofs.signLedgerRange not implemented');
  }

  async exportForAuditor(_request: unknown) {
    // TODO: produce signed export blobs for downstream auditors.
    throw new Error('SignedProofs.exportForAuditor not implemented');
  }
}
