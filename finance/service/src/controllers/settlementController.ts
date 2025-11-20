import { Router } from 'express';
import { LedgerService } from '../services/ledgerService';
import { ProofService } from '../services/proofService';
import { ApprovalInput } from '../services/signingProxy';
import { JournalEntry } from '../models/journalEntry';
import crypto from 'crypto';

const DEFAULT_ROLES = (process.env.FINANCE_SETTLEMENT_ROLES || 'FinanceLead').split(',').map((role) => role.trim()).filter(Boolean);

const router = Router();

type IncomingJournal = {
  journal_id?: string;
  journalId?: string;
  batch_id?: string;
  batchId?: string;
  timestamp?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  lines: Array<{
    account_id?: string;
    accountId?: string;
    direction?: 'debit' | 'credit';
    side?: 'debit' | 'credit';
    amount?: number;
    amount_cents?: number;
    memo?: string;
  }>;
};

function normalizeJournal(payload: IncomingJournal): JournalEntry {
  if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) {
    throw new Error('journal.lines is required');
  }
  const journalId = payload.journal_id || payload.journalId || crypto.randomUUID();
  const batchId = payload.batch_id || payload.batchId || `batch-${journalId}`;
  const timestamp = payload.timestamp || new Date().toISOString();
  const currency = payload.currency || 'USD';
  const lines = payload.lines.map((line) => {
    const accountId = line.account_id || line.accountId;
    const direction = (line.direction || line.side) as 'debit' | 'credit';
    const amount = Number(line.amount ?? line.amount_cents);
    if (!accountId || !direction || !Number.isFinite(amount)) {
      throw new Error('journal lines require account_id, direction, amount');
    }
    return {
      accountId,
      direction,
      amount,
      memo: line.memo,
    };
  });
  return {
    journalId,
    batchId,
    timestamp,
    currency,
    lines,
    metadata: payload.metadata,
  };
}

function resolveRoles(required?: string[]): string[] {
  if (required && required.length) {
    return required;
  }
  return DEFAULT_ROLES.length ? DEFAULT_ROLES : ['FinanceLead'];
}

function resolveApprovals(approvals: ApprovalInput[] | undefined, roles: string[], fallbackSigner: string): ApprovalInput[] {
  if (approvals && approvals.length) {
    return approvals;
  }
  return roles.map((role) => ({ role, signer: fallbackSigner }));
}

export default function settlementRouter(ledgerService: LedgerService, proofService: ProofService): Router {
  router.post('/', async (req, res, next) => {
    try {
      const { journal: rawJournal, approvals, requiredRoles, actor, idempotency_key: idempotencyKey, proof_window } = req.body || {};
      if (!rawJournal) {
        return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'journal is required' } });
      }
      const journal = normalizeJournal(rawJournal);
      const idempotency = idempotencyKey || journal.journalId;
      const actorId = actor || 'marketplace-service';

      const posted = await ledgerService.postEntries([journal], actorId, { idempotencyKey: idempotency });
      const entry = posted[0];
      const from = proof_window?.from || entry?.timestamp || new Date().toISOString();
      const to = proof_window?.to || entry?.timestamp || from;
      const roles = resolveRoles(Array.isArray(requiredRoles) ? requiredRoles : undefined);
      const approvalList = resolveApprovals(approvals, roles, actorId);

      const proof = await proofService.buildProof(from, to, approvalList, roles);
      const signature = proof.signatures[0];

      return res.json({
        ok: true,
        ledger_proof: {
          ledger_proof_id: proof.proofId,
          signer_kid: signature?.keyId,
          signature: signature?.signature,
          ts: signature?.signedAt,
          proof,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
