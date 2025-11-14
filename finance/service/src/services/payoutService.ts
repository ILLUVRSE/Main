import { LedgerRepository } from '../db/repository/ledgerRepository';
import { AuditService } from '../audit/auditService';
import { Payout, PayoutApproval } from '../models/payout';
import { PayoutProviderAdapter } from '../integrations/payoutProviderAdapter';

interface MultisigRule {
  threshold: number; // amount in cents
  roles: string[];
}

const RULES: MultisigRule[] = [
  { threshold: 10_000_00, roles: ['FinanceLead'] },
  { threshold: 250_000_00, roles: ['FinanceLead', 'SecurityEngineer'] },
  { threshold: Number.MAX_SAFE_INTEGER, roles: ['FinanceLead', 'SecurityEngineer', 'SuperAdmin'] },
];

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export class PayoutService {
  constructor(
    private repo: LedgerRepository,
    private audit: AuditService,
    private payoutProvider: PayoutProviderAdapter
  ) {}

  determineRequiredRoles(amountCents: number): string[] {
    return RULES.find((rule) => amountCents <= rule.threshold)?.roles ?? ['FinanceLead'];
  }

  async requestPayout(payout: Payout, actor: string): Promise<Payout> {
    const enriched: Payout = {
      ...payout,
      status: payout.status ?? 'pending_approval',
      approvals: payout.approvals ?? [],
    };
    await this.repo.recordPayout(enriched);
    await this.audit.record({
      eventType: 'payout.requested',
      actor,
      subjectId: enriched.payoutId,
      payload: { amount: enriched.amount, currency: enriched.currency },
    });
    return enriched;
  }

  async getPayout(payoutId: string): Promise<Payout> {
    return this.getPayoutOrThrow(payoutId);
  }

  async recordApproval(payoutId: string, approval: PayoutApproval): Promise<Payout> {
    const payout = await this.getPayoutOrThrow(payoutId);
    if (payout.requestedBy === approval.approver) {
      throw new Error('Initiator cannot approve their own payout');
    }

    const freshApprovals = (payout.approvals ?? []).filter((existing) =>
      Date.now() - Date.parse(existing.approvedAt) < APPROVAL_TTL_MS
    );
    if (freshApprovals.some((existing) => existing.role === approval.role && existing.approver === approval.approver)) {
      throw new Error(`Role ${approval.role} already approved by ${approval.approver}`);
    }

    const approvals = [...freshApprovals, approval];
    const required = this.determineRequiredRoles(payout.amount);
    const hasQuorum = required.every((role) => approvals.some((a) => a.role === role));
    const status = hasQuorum ? 'approved' : 'awaiting_signatures';

    await this.repo.updatePayout(payoutId, { approvals, status });
    await this.audit.record({
      eventType: 'payout.approval',
      actor: approval.approver,
      role: approval.role,
      subjectId: payoutId,
      payload: { signature: approval.signature },
    });

    if (hasQuorum) {
      return this.releasePayout({ ...payout, approvals, status: 'approved' });
    }

    return { ...payout, approvals, status };
  }

  private async releasePayout(payout: Payout): Promise<Payout> {
    try {
      const settlement = await this.payoutProvider.triggerPayout({
        payoutId: payout.payoutId,
        amount: payout.amount,
        currency: payout.currency,
        destination: payout.destination,
        memo: payout.memo,
      });
      const nextStatus =
        settlement.status === 'failed' ? 'failed' : settlement.status === 'pending' ? 'approved' : 'released';
      await this.repo.updatePayout(payout.payoutId, {
        status: nextStatus,
        providerReference: settlement.providerReference,
      });
      const released: Payout = {
        ...payout,
        status: nextStatus,
        providerReference: settlement.providerReference,
      };
      await this.audit.record({
        eventType: 'payout.released',
        actor: 'system',
        subjectId: payout.payoutId,
        payload: { providerReference: settlement.providerReference, status: released.status },
      });
      return released;
    } catch (error) {
      await this.repo.updatePayout(payout.payoutId, { status: 'failed' });
      await this.audit.record({
        eventType: 'payout.failed',
        actor: 'system',
        subjectId: payout.payoutId,
        payload: { reason: (error as Error).message },
      });
      throw error;
    }
  }

  private async getPayoutOrThrow(payoutId: string): Promise<Payout> {
    const payout = await this.repo.getPayout(payoutId);
    if (!payout) {
      throw new Error(`Payout ${payoutId} not found`);
    }
    return payout;
  }
}
