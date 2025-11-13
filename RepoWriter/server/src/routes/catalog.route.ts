// catalog.route.ts

import express from 'express';
import { listItems, previewItem } from '../services/catalog.js';

const router = express.Router();

router.get('/items', listItems);
router.get('/items/:id/preview', previewItem);

export default router;
