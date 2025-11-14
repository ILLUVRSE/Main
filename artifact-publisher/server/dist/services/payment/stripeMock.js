import { deterministicId } from '../../utils/deterministic.js';
export class StripeMock {
    publishableKey;
    constructor(publishableKey) {
        this.publishableKey = publishableKey;
    }
    charge(amount, currency, request) {
        const fingerprint = JSON.stringify({
            publishableKey: this.publishableKey,
            amount,
            currency,
            customer: request.customerId,
            items: request.items,
        });
        return {
            paymentId: deterministicId(fingerprint, 'pay'),
            amount,
            currency,
            status: 'captured',
            processor: 'stripe-mock',
        };
    }
}
