const pool = require('../config/database');

// Read-only data access for portfolio valuation: a user's active holdings joined
// to their latest market price. LEFT JOIN so an unpriced asset still appears
// (current_price = null) rather than silently dropping out of the portfolio.
const portfolioRepository = {
  async findHoldingsWithPrices(userId, client = pool) {
    const { rows } = await client.query(
      `SELECT a.symbol,
              p.quantity,
              p.average_buy_price,
              m.price AS current_price
       FROM positions p
       JOIN assets a ON a.id = p.asset_id
       LEFT JOIN market_prices m ON m.asset_id = p.asset_id
       WHERE p.user_id = $1 AND p.quantity > 0
       ORDER BY a.symbol`,
      [userId]
    );
    return rows;
  },
};

module.exports = portfolioRepository;
