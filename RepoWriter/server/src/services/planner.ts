// Import necessary modules
const express = require('express');
const router = express.Router();

// Define the /api/hello endpoint
router.get('/api/hello', (req, res) => {
    res.status(200).json({ msg: 'hello' });
});

// Export the router
module.exports = router;
