// Import necessary modules
import express from 'express';

const router = express.Router();

// Define the /api/hello endpoint
router.get('/api/hello', (req, res) => {
    res.status(200).json({ msg: 'hello' });
});

export default router;
