const Decimal = require('decimal.js');

const AppError = require('../utils/AppError');
const leaderboardRepository = require('../repositories/leaderboard.repository');

const SCALE = 4;
const money = (value) => new Decimal(value).toFixed(SCALE);
const pct = (value) => new Decimal(value).toFixed(SCALE);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// ROI baseline — the wallet's default starting cash (no deposits exist).
const STARTING_CAPITAL = '100000';

const leaderboardService = {
  // Ranked users by total equity (cash + holdings at current price). Since every
  // account starts at STARTING_CAPITAL with no deposits, equity order equals ROI
  // order — we rank by equity and derive ROI for display.
  async getLeaderboard({ limit } = {}) {
    const n = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      throw new AppError(`limit must be an integer between 1 and ${MAX_LIMIT}.`, 400);
    }

    const rows = await leaderboardRepository.findRankedByEquity(n);
    const start = new Decimal(STARTING_CAPITAL);

    return rows.map((row, index) => {
      const equity = new Decimal(row.balance).plus(row.holdings_value);
      const roi = equity.minus(start).div(start).times(100);
      return {
        rank: index + 1,
        userId: row.id,
        username: row.username,
        totalEquity: money(equity),
        roiPct: pct(roi),
        hasUnpricedHoldings: row.has_unpriced,
      };
    });
  },
};

module.exports = leaderboardService;
