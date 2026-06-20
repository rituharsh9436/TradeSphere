const pool = require('../config/database');

// Data-access for the positions table (a user's holding of one asset).
const positionRepository = {
  // Locks the position row FOR UPDATE within a transaction. Returns null if the
  // user holds no position in the asset yet.
  async findForUpdate(userId, assetId, client) {
    const { rows } = await client.query(
      `SELECT id, user_id, asset_id, quantity, average_buy_price
       FROM positions
       WHERE user_id = $1 AND asset_id = $2
       FOR UPDATE`,
      [userId, assetId]
    );
    return rows[0] || null;
  },

  async findByUser(userId, client = pool) {
    const { rows } = await client.query(
      `SELECT p.asset_id, a.symbol, p.quantity, p.average_buy_price, p.updated_at
       FROM positions p
       JOIN assets a ON a.id = p.asset_id
       WHERE p.user_id = $1 AND p.quantity > 0
       ORDER BY a.symbol`,
      [userId]
    );
    return rows;
  },

  async create({ userId, assetId, quantity, averageBuyPrice }, client = pool) {
    const { rows } = await client.query(
      `INSERT INTO positions (user_id, asset_id, quantity, average_buy_price)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, asset_id, quantity, average_buy_price`,
      [userId, assetId, quantity, averageBuyPrice]
    );
    return rows[0];
  },

  async update({ userId, assetId, quantity, averageBuyPrice }, client = pool) {
    const { rows } = await client.query(
      `UPDATE positions
       SET quantity = $3, average_buy_price = $4, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND asset_id = $2
       RETURNING id, user_id, asset_id, quantity, average_buy_price`,
      [userId, assetId, quantity, averageBuyPrice]
    );
    return rows[0] || null;
  },
};

module.exports = positionRepository;
