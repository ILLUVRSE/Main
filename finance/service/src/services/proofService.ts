import crypto from 'crypto';
import { LedgerRepository, ProofManifestRecord } from '../db/repository/ledgerRepository';
import { canonicalJson } from '../utils/canonicalize';
import { buildHashChain } from '../utils/hashchain';
import { ApprovalInput, SigningProxy, SignatureRecord } from './signingProxy';

export interface ProofPackage {
  proofId: string;
  manifest: Record<string, unknown>;
  ledgerLines: string[];
  hashChain: ReturnType<typeof buildHashChain>;
  signatures: SignatureRecord[];
}

export interface ProofBuildOptions {
  proofId?: string;
  s3ObjectKey?: string;
}

export class ProofService {
  constructor(private repo: LedgerRepository, private signingProxy: SigningProxy) {}

  async buildProof(
    from: string,
    to: string,
    approvals: ApprovalInput[],
    requiredRoles?: string[],
    options: ProofBuildOptions = {}
  ): Promise<ProofPackage> {
    const entries = await this.repo.fetchLedgerRange(from, to);
    const ledgerLines = entries.map((entry) => canonicalJson(entry));
    const hashChain = buildHashChain(ledgerLines);
    const lastHash = hashChain.length ? hashChain[hashChain.length - 1].hash : '';
    const manifest = {
      range: { from, to },
      entries: entries.length,
      rootHash: lastHash,
    };
    const manifestHash = crypto.createHash('sha256').update(canonicalJson(manifest)).digest('hex');

    const roles = requiredRoles ?? [...new Set(approvals.map((a) => a.role))];
    const signatures = await this.signingProxy.sign(
      {
        manifestHash,
        payloadHash: lastHash,
        requiredRoles: roles,
      },
      approvals
    );
    const proofId = options.proofId ?? crypto.randomUUID();
    await this.repo.recordProofManifest({
      proofId,
      rangeFrom: from,
      rangeTo: to,
      manifest,
      manifestHash,
      rootHash: lastHash,
      s3ObjectKey: options.s3ObjectKey,
    });

    return { proofId, manifest, ledgerLines, hashChain, signatures };
  }

  async getProofManifest(proofId: string): Promise<ProofManifestRecord | undefined> {
    return this.repo.getProofManifest(proofId);
  }
}
