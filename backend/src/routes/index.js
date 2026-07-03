const express = require('express');
const userRoutes = require('./user.routes');
const orderRoutes = require('./order.routes');
const marketRoutes = require('./market.routes');
const leaderboardRoutes = require('./leaderboard.routes');
const authRoutes = require('./auth.routes');
const meRoutes = require('./me.routes');

const router = express.Router();

// Mount domain routers here as they are built (positions, leaderboard...).
router.use('/users', userRoutes);
router.use('/orders', orderRoutes);
router.use('/market', marketRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/auth', authRoutes);
router.use('/me', meRoutes);

module.exports = router;
