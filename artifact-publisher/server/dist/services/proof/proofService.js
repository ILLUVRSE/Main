import crypto from 'crypto';
import { deterministicHash, deterministicId } from '../../utils/deterministic.js';
export class ProofService {
    secret;
    constructor(secret) {
        this.secret = secret;
    }
    generateProof(payload) {
        const payloadStr = JSON.stringify(payload);
        const payloadHash = deterministicHash(payloadStr);
        const signature = crypto.createHmac('sha256', this.secret).update(payloadHash).digest('hex');
        return {
            proofId: deterministicId(`${payloadHash}-${this.secret}`, 'proof'),
            signature,
            payloadHash,
            issuedAt: new Date(0).toISOString(),
        };
    }
    verifyProof(record, payload) {
        const payloadHash = deterministicHash(JSON.stringify(payload));
        if (payloadHash !== record.payloadHash) {
            return false;
        }
        const expectedSignature = crypto.createHmac('sha256', this.secret).update(payloadHash).digest('hex');
        return expectedSignature === record.signature;
    }
}
