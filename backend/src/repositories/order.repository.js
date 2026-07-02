const pool = require('../config/database');

// Data-access for the orders table.
const orderRepository = {
  async create(
    { userId, assetId, orderType, side, quantity, targetPrice = null, status = 'PENDING' },
    client = pool
  ) {
    const { rows } = await client.query(
      `INSERT INTO orders (user_id, asset_id, order_type, side, quantity, target_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, asset_id, order_type, side, quantity, target_price, status, created_at`,
      [userId, assetId, orderType, side, quantity, targetPrice, status]
    );
    return rows[0];
  },

  async updateStatus(id, status, client = pool) {
    const { rows } = await client.query(
      `UPDATE orders
       SET status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, status`,
      [id, status]
    );
    return rows[0] || null;
  },

  // PENDING limit orders for one asset — the matcher's candidate set per tick.
  async findPendingLimitByAsset(assetId, client = pool) {
    const { rows } = await client.query(
      `SELECT id, user_id, side, quantity, target_price
       FROM orders
       WHERE asset_id = $1 AND order_type = 'LIMIT' AND status = 'PENDING'`,
      [assetId]
    );
    return rows;
  },

  // Locks a single order row so a fill/cancel can re-check status before mutating.
  async findByIdForUpdate(id, client = pool) {
    const { rows } = await client.query(
      `SELECT id, user_id, asset_id, order_type, side, quantity, target_price, status
       FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    return rows[0] || null;
  },

  async listByUser(userId, client = pool) {
    const { rows } = await client.query(
      `SELECT o.id, o.order_type, o.side, o.quantity, o.target_price, o.status,
              o.created_at, a.symbol
       FROM orders o
       JOIN assets a ON a.id = o.asset_id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC`,
      [userId]
    );
    return rows;
  },
};

module.exports = orderRepository;
