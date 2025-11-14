import { OrderRepository } from '../repository/orderRepository.js';
import {
  CheckoutRequest,
  CheckoutResult,
  DeliveryRecord,
  LicenseDocument,
  PaymentRecord,
} from '../types.js';
import { deterministicId, stableSort } from '../utils/deterministic.js';
import { StripeMock } from './payment/stripeMock.js';
import { LedgerMock } from './finance/ledgerMock.js';
import { ProofService } from './proof/proofService.js';
import { LicenseService } from './license/licenseService.js';
import { DeliveryService } from './delivery/deliveryService.js';
import { KernelClient } from './kernel/kernelClient.js';

const PRICE_BOOK: Record<string, number> = {
  'creator-basic': 1200,
  'creator-pro': 2500,
  'artifact-license': 800,
  'artifact-compliance': 450,
};

export class CheckoutService {
  constructor(
    private readonly stripe: StripeMock,
    private readonly ledger: LedgerMock,
    private readonly proofService: ProofService,
    private readonly licenseService: LicenseService,
    private readonly deliveryService: DeliveryService,
    private readonly kernelClient: KernelClient,
    private readonly orders: OrderRepository,
    private readonly deterministicSalt: string,
  ) {}

  private calculateTotal(request: CheckoutRequest): number {
    if (!request.items.length) {
      throw new Error('Cart cannot be empty');
    }

    return stableSort(request.items, (item) => `${item.sku}-${item.quantity}`).reduce(
      (acc, item) => {
        const unitPrice = PRICE_BOOK[item.sku];
        if (!unitPrice) {
          throw new Error(`Unknown SKU ${item.sku}`);
        }
        return acc + unitPrice * item.quantity;
      },
      0,
    );
  }

  async processCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const total = this.calculateTotal(request);
    const fingerprint = JSON.stringify({ request, total, salt: this.deterministicSalt });
    const orderId = deterministicId(fingerprint, 'order');
    const payment = this.stripe.charge(total, request.currency, request);
    const finance = this.ledger.record(total, request.currency);
    const proof = this.proofService.generateProof({
      orderId,
      paymentId: payment.paymentId,
      financeEntry: finance.entryId,
    });
    const license = this.licenseService.issue(request.customerId, proof);
    const delivery = this.deliveryService.deliver(orderId, license);
    const audit = await this.kernelClient.logAudit({
      orderId,
      licenseId: license.licenseId,
      total,
    });

    const result: CheckoutResult = {
      orderId,
      total,
      currency: request.currency,
      payment,
      finance,
      proof,
      license,
      delivery,
      audit,
    };

    this.orders.save(result);
    return result;
  }

  findOrder(orderId: string): CheckoutResult | undefined {
    return this.orders.find(orderId);
  }

  latestDelivery(orderId: string): DeliveryRecord | undefined {
    return this.orders.find(orderId)?.delivery;
  }

  licenseFor(orderId: string): LicenseDocument | undefined {
    return this.orders.find(orderId)?.license;
  }
}
