const leaderboardService = require('../services/leaderboard.service');
const catchAsync = require('../utils/catchAsync');

const leaderboardController = {
  // GET /api/leaderboard?limit=  — users ranked by total equity.
  getLeaderboard: catchAsync(async (req, res) => {
    const entries = await leaderboardService.getLeaderboard({ limit: req.query.limit });
    res.status(200).json({ status: 'success', results: entries.length, data: entries });
  }),
};

module.exports = leaderboardController;
