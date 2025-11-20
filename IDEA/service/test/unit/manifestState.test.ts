import { describe, expect, test } from 'vitest';

function nextStatus(current: string, approvals: number, threshold: number): string {
  if (current !== 'awaiting_multisig' && current !== 'multisig_partial') {
    return current;
  }
  return approvals >= threshold ? 'multisig_complete' : 'multisig_partial';
}

describe('manifest multisig state transitions', () => {
  test('remains partial until threshold reached', () => {
    expect(nextStatus('awaiting_multisig', 1, 3)).toBe('multisig_partial');
    expect(nextStatus('multisig_partial', 2, 3)).toBe('multisig_partial');
  });

  test('transitions to complete when threshold satisfied', () => {
    expect(nextStatus('awaiting_multisig', 3, 3)).toBe('multisig_complete');
    expect(nextStatus('multisig_partial', 4, 3)).toBe('multisig_complete');
  });

  test('non-multisig states unaffected', () => {
    expect(nextStatus('draft', 10, 1)).toBe('draft');
  });
});
