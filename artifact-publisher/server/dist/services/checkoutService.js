import { deterministicId, stableSort } from '../utils/deterministic.js';
const PRICE_BOOK = {
    'creator-basic': 1200,
    'creator-pro': 2500,
    'artifact-license': 800,
    'artifact-compliance': 450,
};
export class CheckoutService {
    stripe;
    ledger;
    proofService;
    licenseService;
    deliveryService;
    kernelClient;
    orders;
    deterministicSalt;
    constructor(stripe, ledger, proofService, licenseService, deliveryService, kernelClient, orders, deterministicSalt) {
        this.stripe = stripe;
        this.ledger = ledger;
        this.proofService = proofService;
        this.licenseService = licenseService;
        this.deliveryService = deliveryService;
        this.kernelClient = kernelClient;
        this.orders = orders;
        this.deterministicSalt = deterministicSalt;
    }
    calculateTotal(request) {
        if (!request.items.length) {
            throw new Error('Cart cannot be empty');
        }
        return stableSort(request.items, (item) => `${item.sku}-${item.quantity}`).reduce((acc, item) => {
            const unitPrice = PRICE_BOOK[item.sku];
            if (!unitPrice) {
                throw new Error(`Unknown SKU ${item.sku}`);
            }
            return acc + unitPrice * item.quantity;
        }, 0);
    }
    async processCheckout(request) {
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
        const result = {
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
    findOrder(orderId) {
        return this.orders.find(orderId);
    }
    latestDelivery(orderId) {
        return this.orders.find(orderId)?.delivery;
    }
    licenseFor(orderId) {
        return this.orders.find(orderId)?.license;
    }
}
