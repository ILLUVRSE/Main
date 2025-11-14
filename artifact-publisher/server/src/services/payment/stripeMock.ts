import { deterministicId } from '../../utils/deterministic.js';
import { CheckoutRequest, PaymentRecord } from '../../types.js';

export class StripeMock {
  constructor(private readonly publishableKey: string) {}

  charge(amount: number, currency: string, request: CheckoutRequest): PaymentRecord {
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
