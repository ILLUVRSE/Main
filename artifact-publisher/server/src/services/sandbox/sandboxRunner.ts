import seedrandom from 'seedrandom';
import crypto from 'crypto';

export interface SandboxInstruction {
  op: 'checkout' | 'license' | 'proof';
  payload: Record<string, unknown>;
}

export interface SandboxResult {
  transcript: { op: string; digest: string; timestamp: string }[];
  exitCode: number;
}

export class SandboxRunner {
  constructor(private readonly seed: string) {}

  run(instructions: SandboxInstruction[]): SandboxResult {
    const prng = seedrandom(`${this.seed}:${instructions.length}`);
    const transcript = instructions.map((instruction, index) => {
      const digestSource = JSON.stringify({ instruction, index, seed: this.seed });
      const digest = crypto.createHash('sha256').update(digestSource).digest('hex').slice(0, 16);
      const timestamp = new Date(Math.floor(prng() * 1_700_000_000_000)).toISOString();
      return {
        op: instruction.op,
        digest,
        timestamp,
      };
    });

    return {
      transcript,
      exitCode: 0,
    };
  }
}
