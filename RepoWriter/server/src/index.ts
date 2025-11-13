// index.ts

import express from 'express';
import catalogRoutes from './routes/catalog.route.js';
import checkoutRoutes from './routes/checkout.route.js';

const app = express();
app.use(express.json());
app.use('/api/catalog', catalogRoutes);
app.use('/api/checkout', checkoutRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
