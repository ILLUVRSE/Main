/**
 * marketplace/ui/src/lib/utils/formatCurrency.ts
 *
 * Small helper to format an integer amount in cents to a human-readable currency string.
 * Defaults to USD. Uses Intl.NumberFormat when available.
 *
 * Usage:
 *   formatCurrency(1999) -> "$19.99"
 *   formatCurrency(1999, 'USD', { minimumFractionDigits: 2 })
 */

type FormatOpts = Intl.NumberFormatOptions;

export function formatCurrency(
  amountCents: number,
  currency: string = 'USD',
  opts: FormatOpts = {}
): string {
  if (typeof amountCents !== 'number' || Number.isNaN(amountCents)) return '—';
  const amount = amountCents / 100;

  try {
    const nf = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...opts,
    });
    return nf.format(amount);
  } catch {
    // Fallback simple formatter
    const sign = amount < 0 ? '-' : '';
    const abs = Math.abs(amount);
    return `${sign}${currency} ${abs.toFixed(2)}`;
  }
}

export default formatCurrency;

