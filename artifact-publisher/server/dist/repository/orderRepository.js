export class OrderRepository {
    orders = new Map();
    save(order) {
        this.orders.set(order.orderId, order);
        return order;
    }
    find(orderId) {
        return this.orders.get(orderId);
    }
    list() {
        return [...this.orders.values()];
    }
}
