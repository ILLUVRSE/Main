export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void' | 'disputed';

export interface Invoice {
  invoiceId: string;
  accountId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  dueDate: string;
  metadata?: Record<string, string>;
}
