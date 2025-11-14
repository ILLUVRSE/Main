export type PayoutStatus = 'pending_approval' | 'awaiting_signatures' | 'approved' | 'released' | 'failed';

export interface PayoutDestination {
  provider: string;
  accountReference: string;
}

export interface PayoutApproval {
  approver: string;
  role: string;
  signature: string;
  comment?: string;
  approvedAt: string;
}

export interface Payout {
  payoutId: string;
  invoiceId?: string;
  amount: number;
  currency: string;
  destination: PayoutDestination;
  memo?: string;
  requestedBy: string;
  status: PayoutStatus;
  approvals: PayoutApproval[];
  providerReference?: string;
}
