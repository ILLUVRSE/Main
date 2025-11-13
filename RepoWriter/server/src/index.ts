// index.ts

import express from 'express';
import catalogRoutes from './routes/catalog.route';
import checkoutRoutes from './routes/checkout.route';

const app = express();
app.use(express.json());
app.use('/api/catalog', catalogRoutes);
app.use('/api/checkout', checkoutRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
