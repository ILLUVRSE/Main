import { describe, it, expect } from 'vitest';
import { SandboxRunner } from '../../src/services/sandbox/sandboxRunner.js';

describe('SandboxRunner determinism', () => {
  it('produces deterministic transcripts for identical instructions', () => {
    const runner = new SandboxRunner('seed');
    const instructions = [
      { op: 'checkout', payload: { id: 1 } },
      { op: 'proof', payload: { ref: 'abc' } },
    ];

    const first = runner.run(instructions);
    const second = runner.run(instructions);

    expect(first).toEqual(second);
    expect(first.exitCode).toBe(0);
  });

  it('changes output when instructions change', () => {
    const runner = new SandboxRunner('seed');
    const first = runner.run([{ op: 'checkout', payload: { id: 1 } }]);
    const second = runner.run([{ op: 'checkout', payload: { id: 2 } }]);
    expect(first.transcript[0].digest).not.toEqual(second.transcript[0].digest);
  });
});
