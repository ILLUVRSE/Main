import { CheckoutResult } from '../types.js';

export class OrderRepository {
  private readonly orders = new Map<string, CheckoutResult>();

  save(order: CheckoutResult): CheckoutResult {
    this.orders.set(order.orderId, order);
    return order;
  }

  find(orderId: string): CheckoutResult | undefined {
    return this.orders.get(orderId);
  }

  list(): CheckoutResult[] {
    return [...this.orders.values()];
  }
}
