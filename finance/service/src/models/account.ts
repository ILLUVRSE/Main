export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface Account {
  accountId: string;
  ledgerId: string;
  type: AccountType;
  name: string;
  currency: string;
  metadata?: Record<string, string>;
  balances: {
    debit: number;
    credit: number;
  };
}
