const express = require('express');
const userRoutes = require('./user.routes');
const orderRoutes = require('./order.routes');
const assetRoutes = require('./asset.routes');

const router = express.Router();

// Mount domain routers here as they are built (positions, leaderboard...).
router.use('/users', userRoutes);
router.use('/orders', orderRoutes);
router.use('/assets', assetRoutes);

module.exports = router;
