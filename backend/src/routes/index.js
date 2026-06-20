const express = require('express');
const userRoutes = require('./user.routes');

const router = express.Router();

// Mount domain routers here as they are built (orders, positions, leaderboard...).
router.use('/users', userRoutes);

module.exports = router;
