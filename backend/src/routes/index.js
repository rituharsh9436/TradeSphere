const express = require('express');
const userRoutes = require('./user.routes');
const orderRoutes = require('./order.routes');
const marketRoutes = require('./market.routes');
const leaderboardRoutes = require('./leaderboard.routes');
const authRoutes = require('./auth.routes');
const meRoutes = require('./me.routes');

const router = express.Router();

// Auth surface: the ONLY user-scoped surface exposed in production. Every route
// under /me reads the acting user from a verified token (never the client).
router.use('/auth', authRoutes);
router.use('/me', meRoutes);

// Public, read-only routers — no user-scoped mutation, safe to expose.
router.use('/market', marketRoutes);
router.use('/leaderboard', leaderboardRoutes);

// Legacy dev bridge (pre-auth): /users and /orders trust a client-supplied
// userId, so they let anyone act as any account. They are retained for local
// development and the existing test suite, but MUST NOT be mounted in
// production — /api/me/* fully supersedes them. Set NODE_ENV=production to drop
// them and leave only the authenticated surface above.
if (process.env.NODE_ENV !== 'production') {
  router.use('/users', userRoutes);
  router.use('/orders', orderRoutes);
}

module.exports = router;
