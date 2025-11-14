import seedrandom from 'seedrandom';
import crypto from 'crypto';
export class SandboxRunner {
    seed;
    constructor(seed) {
        this.seed = seed;
    }
    run(instructions) {
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
