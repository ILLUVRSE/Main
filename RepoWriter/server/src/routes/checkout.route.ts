// checkout.route.ts

import express from 'express';
import { checkout, secureDelivery } from '../services/checkout';

const router = express.Router();

router.post('/checkout', checkout);
router.post('/delivery/:id', secureDelivery);

export default router;
