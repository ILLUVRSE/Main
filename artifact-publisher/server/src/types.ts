export interface CheckoutItem {
  sku: string;
  quantity: number;
}

export interface CheckoutRequest {
  customerId: string;
  items: CheckoutItem[];
  currency: string;
  email: string;
}

export interface PaymentRecord {
  paymentId: string;
  amount: number;
  currency: string;
  status: 'authorized' | 'captured';
  processor: 'stripe-mock';
}

export interface FinanceEntry {
  entryId: string;
  ledgerId: string;
  credit: number;
  debit: number;
  currency: string;
}

export interface ProofRecord {
  proofId: string;
  signature: string;
  payloadHash: string;
  issuedAt: string;
}

export interface LicenseDocument {
  licenseId: string;
  licenseKey: string;
  issuedTo: string;
  expiresAt: string;
}

export interface DeliveryRecord {
  deliveryId: string;
  artifactUrl: string;
  cipherText: string;
}

export interface AuditRecord {
  auditId: string;
  event: string;
}

export interface CheckoutResult {
  orderId: string;
  total: number;
  currency: string;
  payment: PaymentRecord;
  finance: FinanceEntry;
  proof: ProofRecord;
  license: LicenseDocument;
  delivery: DeliveryRecord;
  audit: AuditRecord;
}

export interface MultisigUpgradeRequest {
  version: string;
  binaryHash: string;
  notes?: string;
  approvers: string[];
}

export interface MultisigUpgradeResult {
  upgradeId: string;
  approvals: { approver: string; approvedAt: string }[];
  appliedAt: string;
  version: string;
}
