const pool = require('../config/database');

// Read-only ranking aggregation. Every user (with their wallet) is valued as
// cash + Σ(holding qty × latest price); unpriced holdings (no market_prices row)
// contribute NULL to the SUM and are skipped, matching the portfolio total, and
// are surfaced via has_unpriced. Ordered by equity DESC with a deterministic
// tie-break so ranks are stable.
const leaderboardRepository = {
  async findRankedByEquity(limit, client = pool) {
    const { rows } = await client.query(
      `SELECT u.id, u.username, u.created_at, w.balance,
              COALESCE(SUM(p.quantity * m.price), 0) AS holdings_value,
              BOOL_OR(p.asset_id IS NOT NULL AND m.price IS NULL) AS has_unpriced
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       LEFT JOIN positions p ON p.user_id = u.id AND p.quantity > 0
       LEFT JOIN market_prices m ON m.asset_id = p.asset_id
       GROUP BY u.id, u.username, u.created_at, w.balance
       ORDER BY (w.balance + COALESCE(SUM(p.quantity * m.price), 0)) DESC,
                u.created_at ASC, u.id ASC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },
};

module.exports = leaderboardRepository;
