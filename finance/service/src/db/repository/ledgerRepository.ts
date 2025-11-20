import { JournalEntry } from '../../models/journalEntry';
import { Payout } from '../../models/payout';

export interface ProofManifestRecord {
  proofId: string;
  rangeFrom: string;
  rangeTo: string;
  manifest: Record<string, unknown>;
  manifestHash: string;
  rootHash: string;
  s3ObjectKey?: string;
}

export interface IdempotentRequest {
  payloadHash: string;
  journalIds: string[];
}

export interface LedgerRepository {
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
  insertJournalEntries(entries: JournalEntry[]): Promise<void>;
  recordPayout(payout: Payout): Promise<void>;
  updatePayout(payoutId: string, patch: Partial<Payout>): Promise<void>;
  fetchLedgerRange(from: string, to: string): Promise<JournalEntry[]>;
  getPayout(payoutId: string): Promise<Payout | undefined>;
  recordProofManifest(manifest: ProofManifestRecord): Promise<void>;
  getProofManifest(proofId: string): Promise<ProofManifestRecord | undefined>;
  findIdempotentRequest(key: string): Promise<IdempotentRequest | undefined>;
  recordIdempotentRequest(key: string, payloadHash: string, journalIds: string[], actor: string): Promise<void>;
  fetchJournal(journalId: string): Promise<JournalEntry | undefined>;
}

export class InMemoryLedgerRepository implements LedgerRepository {
  private entries: JournalEntry[] = [];
  private payouts: Map<string, Payout> = new Map();
  private proofs: ProofManifestRecord[] = [];
  private idem = new Map<string, IdempotentRequest & { actor?: string }>();

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async insertJournalEntries(entries: JournalEntry[]): Promise<void> {
    this.entries.push(...entries);
  }

  async recordPayout(payout: Payout): Promise<void> {
    this.payouts.set(payout.payoutId, payout);
  }

  async updatePayout(payoutId: string, patch: Partial<Payout>): Promise<void> {
    const existing = this.payouts.get(payoutId);
    if (!existing) throw new Error(`Payout ${payoutId} not found`);
    this.payouts.set(payoutId, { ...existing, ...patch });
  }

  async fetchLedgerRange(from: string, to: string): Promise<JournalEntry[]> {
    return this.entries.filter((entry) => entry.timestamp >= from && entry.timestamp <= to);
  }

  async getPayout(payoutId: string): Promise<Payout | undefined> {
    return this.payouts.get(payoutId);
  }

  async recordProofManifest(manifest: ProofManifestRecord): Promise<void> {
    this.proofs.push(manifest);
  }

  async getProofManifest(proofId: string): Promise<ProofManifestRecord | undefined> {
    return this.proofs.find((proof) => proof.proofId === proofId);
  }

  async findIdempotentRequest(key: string): Promise<IdempotentRequest | undefined> {
    return this.idem.get(key);
  }

  async recordIdempotentRequest(key: string, payloadHash: string, journalIds: string[]): Promise<void> {
    this.idem.set(key, { payloadHash, journalIds });
  }

  async fetchJournal(journalId: string): Promise<JournalEntry | undefined> {
    return this.entries.find((entry) => entry.journalId === journalId);
  }
}
