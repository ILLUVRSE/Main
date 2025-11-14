import { Router } from 'express';
import { CheckoutService } from '../services/checkoutService.js';
import { CheckoutRequest } from '../types.js';

const normalizeRequest = (body: any): CheckoutRequest => {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload');
  }

  const items: Array<{ sku: unknown; quantity: unknown }> = Array.isArray(body.items)
    ? body.items
    : [];
  return {
    customerId: String(body.customerId ?? ''),
    email: String(body.email ?? ''),
    currency: String(body.currency ?? 'usd'),
    items: items.map((item) => ({
      sku: String(item.sku),
      quantity: Number(item.quantity ?? 0),
    })),
  };
};

export const createCheckoutRouter = (checkoutService: CheckoutService) => {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const payload = normalizeRequest(req.body);
      const result = await checkoutService.processCheckout(payload);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:orderId', (req, res, next) => {
    try {
      const order = checkoutService.findOrder(req.params.orderId);
      if (!order) {
        res.status(404).json({ message: 'Order not found' });
        return;
      }

      res.json(order);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:orderId/license', (req, res, next) => {
    try {
      const license = checkoutService.licenseFor(req.params.orderId);
      if (!license) {
        res.status(404).json({ message: 'License missing' });
        return;
      }
      res.json(license);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:orderId/delivery', (req, res, next) => {
    try {
      const delivery = checkoutService.latestDelivery(req.params.orderId);
      if (!delivery) {
        res.status(404).json({ message: 'Delivery missing' });
        return;
      }
      res.json(delivery);
    } catch (error) {
      next(error);
    }
  });

  return router;
};
