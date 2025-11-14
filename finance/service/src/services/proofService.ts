import crypto from 'crypto';
import { LedgerRepository } from '../db/repository/ledgerRepository';
import { canonicalJson } from '../utils/canonicalize';
import { buildHashChain } from '../utils/hashchain';
import { SigningProxy, SignatureRecord } from './signingProxy';

export interface ProofPackage {
  manifest: Record<string, unknown>;
  ledgerLines: string[];
  hashChain: ReturnType<typeof buildHashChain>;
  signatures: SignatureRecord[];
}

export class ProofService {
  constructor(private repo: LedgerRepository, private signingProxy: SigningProxy) {}

  async buildProof(from: string, to: string, approvals: SignatureRecord[]): Promise<ProofPackage> {
    const entries = await this.repo.fetchLedgerRange(from, to);
    const ledgerLines = entries.map((entry) => canonicalJson(entry));
    const hashChain = buildHashChain(ledgerLines);
    const manifest = {
      range: { from, to },
      entries: entries.length,
      rootHash: hashChain.at(-1)?.hash,
    };
    const manifestHash = crypto.createHash('sha256').update(canonicalJson(manifest)).digest('hex');

    const signatures = await this.signingProxy.sign({
      manifestHash,
      payloadHash: hashChain.at(-1)?.hash || '',
      requiredRoles: approvals.map((a) => a.role),
    }, approvals);

    return { manifest, ledgerLines, hashChain, signatures };
  }
}
