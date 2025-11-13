// checkout.route.ts

import express from 'express';
import { checkout, secureDelivery } from '../services/checkout.js';

const router = express.Router();

router.post('/checkout', checkout);
router.post('/delivery/:id', secureDelivery);

export default router;
